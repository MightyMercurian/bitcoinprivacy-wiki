(() => {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  const KNOWN_PREFIXES = ['bcrt', 'tltc', 'bc', 'tb', 'sb', 'ltc'];
  const DEFAULT_RELAYS = [
    'https://lnproxy.org/spec',
    'https://lnproxy.lnemail.net/spec',
  ];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const htmlEscape = (value) => String(value ?? '')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');

  const shorten = (value, size = 18) => {
    if (!value) return '--';
    const text = String(value);
    if (text.length <= size * 2 + 3) return text;
    return `${text.slice(0, size)}...${text.slice(-size)}`;
  };

  const setText = (selector, text, root) => {
    const element = $(selector, root);
    if (element) element.textContent = text;
  };

  const setBusy = (root, busy) => {
    const button = $('.ld-wrap-button', root);
    const status = $('.ld-wrap-status', root);
    if (button) button.disabled = busy;
    if (status) status.textContent = busy ? 'Contacting lnproxy relay...' : '';
  };

  const getWidgetState = (root) => {
    if (!root.__lightningDecoderState) {
      root.__lightningDecoderState = {
        original: null,
        wrapped: null,
        relays: [...DEFAULT_RELAYS],
        failedRelays: new Set(),
      };
    }
    return root.__lightningDecoderState;
  };

  const polymod = (values) => {
    let chk = 1;
    for (const value of values) {
      const top = chk >> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ value;
      for (let i = 0; i < 5; i += 1) {
        if ((top >> i) & 1) chk ^= GENERATOR[i];
      }
    }
    return chk;
  };

  const hrpExpand = (hrp) => {
    const expanded = [];
    for (let i = 0; i < hrp.length; i += 1) expanded.push(hrp.charCodeAt(i) >> 5);
    expanded.push(0);
    for (let i = 0; i < hrp.length; i += 1) expanded.push(hrp.charCodeAt(i) & 31);
    return expanded;
  };

  const bech32Decode = (input, limit = 4096) => {
    if (!input || typeof input !== 'string') throw new Error('Input is empty.');
    if (input.length > limit) throw new Error('Input is too long.');
    if (input !== input.toLowerCase() && input !== input.toUpperCase()) {
      throw new Error('Bech32 strings must not mix uppercase and lowercase characters.');
    }

    const value = input.toLowerCase();
    const separator = value.lastIndexOf('1');
    if (separator < 1 || separator + 7 > value.length) throw new Error('Invalid bech32 separator or checksum length.');

    const prefix = value.slice(0, separator);
    const chars = value.slice(separator + 1);
    const words = [];

    for (const char of chars) {
      const index = CHARSET.indexOf(char);
      if (index === -1) throw new Error(`Invalid bech32 character: ${char}`);
      words.push(index);
    }

    if (polymod([...hrpExpand(prefix), ...words]) !== 1) throw new Error('Invalid bech32 checksum.');

    return {
      prefix,
      words: words.slice(0, -6),
    };
  };

  const convertBits = (data, fromBits, toBits, pad = false) => {
    let acc = 0;
    let bits = 0;
    const result = [];
    const maxv = (1 << toBits) - 1;

    for (const value of data) {
      if (value < 0 || value >> fromBits !== 0) throw new Error('Invalid bit group.');
      acc = (acc << fromBits) | value;
      bits += fromBits;
      while (bits >= toBits) {
        bits -= toBits;
        result.push((acc >> bits) & maxv);
      }
    }

    if (pad && bits > 0) {
      result.push((acc << (toBits - bits)) & maxv);
    } else if (!pad && (bits >= fromBits || ((acc << (toBits - bits)) & maxv))) {
      throw new Error('Invalid padding.');
    }

    return result;
  };

  const wordsToBytes = (words) => {
    const bytes = convertBits(words, 5, 8, true);
    if (words.length * 5 % 8 !== 0) bytes.pop();
    return bytes;
  };

  const wordsToHex = (words) => wordsToBytes(words).map((byte) => byte.toString(16).padStart(2, '0')).join('');

  const wordsToText = (words) => new TextDecoder().decode(Uint8Array.from(wordsToBytes(words)));

  const wordsToInt = (words) => words.reduce((total, word) => (total * 32) + word, 0);

  const parseAmount = (amount, multiplier) => {
    if (!amount) return { btc: null, sats: null, millisats: null, display: 'No amount set' };

    const value = BigInt(amount);
    let millisats;

    switch (multiplier || '') {
      case '':
        millisats = value * 100000000000n;
        break;
      case 'm':
        millisats = value * 100000000n;
        break;
      case 'u':
        millisats = value * 100000n;
        break;
      case 'n':
        millisats = value * 100n;
        break;
      case 'p':
        if (value % 10n !== 0n) throw new Error('Pico-BTC invoice amount is below millisatoshi precision.');
        millisats = value / 10n;
        break;
      default:
        throw new Error('Unknown amount multiplier.');
    }

    const sats = millisats / 1000n;
    const btcWhole = millisats / 100000000000n;
    const btcRemainder = millisats % 100000000000n;
    const btc = `${btcWhole}.${btcRemainder.toString().padStart(11, '0').replace(/0+$/, '') || '0'}`;

    return {
      btc,
      sats: sats.toString(),
      millisats: millisats.toString(),
      display: `${sats.toString()} sats (${millisats.toString()} msats)`,
    };
  };

  const parsePrefix = (prefix) => {
    if (!prefix.startsWith('ln')) throw new Error('Not a BOLT11 invoice.');
    const withoutLn = prefix.slice(2);
    const chain = KNOWN_PREFIXES.find((candidate) => withoutLn.startsWith(candidate));
    if (!chain) throw new Error(`Unsupported Lightning invoice prefix: ${prefix}`);

    const amountPart = withoutLn.slice(chain.length);
    const match = amountPart.match(/^(\d*)([munp]?)$/);
    if (!match) throw new Error('Invalid BOLT11 amount prefix.');

    return {
      chain,
      amount: parseAmount(match[1], match[2]),
    };
  };

  const parseRoutingInfo = (words) => {
    const bytes = wordsToBytes(words);
    const routes = [];
    for (let offset = 0; offset + 51 <= bytes.length; offset += 51) {
      const chunk = bytes.slice(offset, offset + 51);
      routes.push({
        pubkey: chunk.slice(0, 33).map((byte) => byte.toString(16).padStart(2, '0')).join(''),
        short_channel_id: chunk.slice(33, 41).map((byte) => byte.toString(16).padStart(2, '0')).join(''),
        fee_base_msat: Number.parseInt(chunk.slice(41, 45).map((byte) => byte.toString(16).padStart(2, '0')).join(''), 16),
        fee_proportional_millionths: Number.parseInt(chunk.slice(45, 49).map((byte) => byte.toString(16).padStart(2, '0')).join(''), 16),
        cltv_expiry_delta: Number.parseInt(chunk.slice(49, 51).map((byte) => byte.toString(16).padStart(2, '0')).join(''), 16),
      });
    }
    return routes;
  };

  const parseBolt11 = (rawInput) => {
    let invoice = rawInput.trim();
    if (invoice.toLowerCase().startsWith('lightning:')) invoice = invoice.slice(10);
    invoice = invoice.toLowerCase();

    const decoded = bech32Decode(invoice, 8192);
    const prefixDetails = parsePrefix(decoded.prefix);
    const data = decoded.words;

    if (data.length < 7 + 104) throw new Error('Invoice is too short.');

    const timestamp = wordsToInt(data.slice(0, 7));
    const tagWords = data.slice(7, -104);
    const signatureWords = data.slice(-104);
    const tags = [];

    for (let cursor = 0; cursor < tagWords.length;) {
      const type = tagWords[cursor];
      const length = wordsToInt(tagWords.slice(cursor + 1, cursor + 3));
      const words = tagWords.slice(cursor + 3, cursor + 3 + length);
      if (words.length !== length) throw new Error('Invoice tag length is invalid.');

      let name = `unknown_${type}`;
      let value;

      if (type === 1) {
        name = 'payment_hash';
        value = wordsToHex(words);
      } else if (type === 13) {
        name = 'description';
        value = wordsToText(words);
      } else if (type === 19) {
        name = 'payee_node_key';
        value = wordsToHex(words);
      } else if (type === 23) {
        name = 'description_hash';
        value = wordsToHex(words);
      } else if (type === 6) {
        name = 'expiry_seconds';
        value = wordsToInt(words);
      } else if (type === 24) {
        name = 'min_final_cltv_expiry';
        value = wordsToInt(words);
      } else if (type === 3) {
        name = 'routing_info';
        value = parseRoutingInfo(words);
      } else if (type === 9) {
        name = 'fallback_address_raw';
        value = wordsToHex(words);
      }

      tags.push({
        type,
        name,
        value,
        length,
        words: words.map((word) => CHARSET[word]).join(''),
      });
      cursor += 3 + length;
    }

    const getTag = (name) => tags.find((tag) => tag.name === name)?.value;
    const expiry = getTag('expiry_seconds') ?? 3600;
    const expiresAt = timestamp + Number(expiry);
    const signatureBytes = wordsToBytes(signatureWords);
    const recoveryFlag = signatureBytes[64] ?? null;
    const signature = signatureBytes.slice(0, 64).map((byte) => byte.toString(16).padStart(2, '0')).join('');

    return {
      type: 'BOLT11 invoice',
      raw: invoice,
      lightningUri: `lightning:${invoice.toUpperCase()}`,
      prefix: decoded.prefix,
      chain: prefixDetails.chain === 'bc' ? 'bitcoin' : prefixDetails.chain,
      amount: prefixDetails.amount,
      timestamp,
      timestampString: new Date(timestamp * 1000).toISOString(),
      expirySeconds: Number(expiry),
      expiresAt,
      expiresAtString: new Date(expiresAt * 1000).toISOString(),
      expired: Date.now() / 1000 > expiresAt,
      paymentHash: getTag('payment_hash') || null,
      description: getTag('description') ?? null,
      descriptionHash: getTag('description_hash') ?? null,
      payeeNodeKey: getTag('payee_node_key') ?? null,
      routingInfo: getTag('routing_info') ?? [],
      minFinalCltvExpiry: getTag('min_final_cltv_expiry') ?? null,
      signature,
      recoveryFlag,
      unknownTags: tags.filter((tag) => tag.name.startsWith('unknown_')),
      tags,
    };
  };

  const parseLnurl = (rawInput) => {
    let value = rawInput.trim();
    if (value.toLowerCase().startsWith('lightning:')) value = value.slice(10);
    if (value.toLowerCase().startsWith('lnurl:')) value = value.slice(6);

    const decoded = bech32Decode(value, 4096);
    if (decoded.prefix !== 'lnurl') throw new Error('Not an LNURL string.');

    return {
      type: 'LNURL',
      raw: value,
      url: wordsToText(decoded.words),
    };
  };

  const parseLightningAddress = (rawInput) => {
    const value = rawInput.trim();
    if (!/^\S+@\S+\.\S+$/.test(value)) throw new Error('Not a Lightning Address.');
    const [username, domain] = value.split('@');
    return {
      type: 'Lightning Address',
      raw: value,
      username,
      domain,
      lnurlp: `https://${domain}/.well-known/lnurlp/${username}`,
    };
  };

  const decodeRequest = (rawInput) => {
    const value = rawInput.trim();
    if (!value) throw new Error('Paste a BOLT11 invoice, LNURL, or Lightning Address first.');
    const normalized = value.toLowerCase().replace(/^lightning:/, '').replace(/^lnurl:/, '');

    if (/^\S+@\S+\.\S+$/.test(value)) return parseLightningAddress(value);
    if (normalized.startsWith('lnurl')) return parseLnurl(value);
    if (normalized.startsWith('ln')) return parseBolt11(value);

    throw new Error('Unsupported request. Paste a BOLT11 invoice, LNURL, or Lightning Address.');
  };

  const tagRanges = (decoded) => {
    if (!decoded || decoded.type !== 'BOLT11 invoice') return [];

    const invoice = decoded.raw;
    const separator = invoice.lastIndexOf('1');
    const prefixEnd = separator + 1 + 7;
    const dataEnd = invoice.length - 110;
    const ranges = [];
    let cursor = prefixEnd;

    decoded.tags.forEach((tag) => {
      const encodedLength = 3 + tag.length;
      ranges.push({
        start: cursor,
        end: cursor + encodedLength,
        name: tag.name,
      });
      cursor += encodedLength;
    });

    ranges.push({ start: 0, end: separator, name: 'amount_prefix' });
    ranges.push({ start: dataEnd, end: dataEnd + 104, name: 'signature' });
    return ranges.sort((a, b) => a.start - b.start);
  };

  const segmentClass = (name) => {
    if (name === 'payment_hash') return 'ld-invoice-segment--hash';
    if (name === 'description' || name === 'description_hash') return 'ld-invoice-segment--description';
    if (name === 'signature') return 'ld-invoice-segment--signature';
    if (name === 'amount_prefix') return 'ld-invoice-segment--amount';
    return 'ld-invoice-segment--other';
  };

  const renderHighlightedInvoice = (decoded) => {
    if (!decoded || decoded.type !== 'BOLT11 invoice') return '';

    const ranges = tagRanges(decoded);
    let cursor = 0;
    let html = '';

    ranges.forEach((range) => {
      if (range.start > cursor) html += htmlEscape(decoded.raw.slice(cursor, range.start));
      html += `<span class="ld-invoice-segment ${segmentClass(range.name)}" title="${htmlEscape(range.name)}">${htmlEscape(decoded.raw.slice(range.start, range.end))}</span>`;
      cursor = range.end;
    });

    if (cursor < decoded.raw.length) html += htmlEscape(decoded.raw.slice(cursor));

    return `
      <details class="ld-invoice-raw" open>
        <summary>Full invoice with highlighted fields</summary>
        <div class="ld-invoice-raw__legend">
          <span class="ld-legend ld-legend--hash">Payment hash</span>
          <span class="ld-legend ld-legend--description">Description</span>
          <span class="ld-legend ld-legend--signature">Signature / destination</span>
          <span class="ld-legend ld-legend--amount">Amount prefix</span>
        </div>
        <div class="ld-invoice-raw__body">${html}</div>
      </details>
    `;
  };

  const renderField = (label, value, mono = false) => `
    <div class="ld-result__item">
      <div class="ld-result__label">${htmlEscape(label)}</div>
      <div class="ld-result__value${mono ? ' ld-result__value--mono' : ''}">${htmlEscape(value ?? '--')}</div>
    </div>
  `;

  const renderUnknownTags = (tags) => {
    if (!tags || !tags.length) return '';
    return tags.map((tag, index) => `
      <details class="ld-result__details">
        <summary>Unknown tag ${index + 1}</summary>
        ${renderField('Tag code', tag.type)}
        ${renderField('Tag words', tag.words, true)}
      </details>
    `).join('');
  };

  const renderRoute = (route, index) => `
    <details class="ld-result__details">
      <summary>Route hint ${index + 1}: ${htmlEscape(shorten(route.pubkey, 10))}</summary>
      ${renderField('Public key', route.pubkey, true)}
      ${renderField('Short channel ID', route.short_channel_id, true)}
      ${renderField('Fee base', `${route.fee_base_msat} msats`)}
      ${renderField('Fee proportional', `${route.fee_proportional_millionths} ppm`)}
      ${renderField('CLTV expiry delta', route.cltv_expiry_delta)}
    </details>
  `;

  const renderDecoded = (decoded) => {
    if (!decoded) return '';

    if (decoded.type === 'Lightning Address') {
      return `
        <div class="ld-result">
          ${renderField('Type', decoded.type)}
          ${renderField('Username', decoded.username)}
          ${renderField('Domain', decoded.domain)}
          ${renderField('LNURL-pay endpoint', decoded.lnurlp, true)}
        </div>
      `;
    }

    if (decoded.type === 'LNURL') {
      return `
        <div class="ld-result">
          ${renderField('Type', decoded.type)}
          ${renderField('Decoded URL', decoded.url, true)}
        </div>
      `;
    }

    return `
      ${renderHighlightedInvoice(decoded)}
      <div class="ld-result">
        ${renderField('Chain', decoded.chain)}
        ${renderField('Amount (Millisatoshis)', decoded.amount.millisats ?? '--')}
        ${renderField('Amount (Satoshis)', decoded.amount.sats ?? '--')}
        ${renderField('Invoice', decoded.raw, true)}
        ${renderField('Prefix', decoded.prefix)}
        ${renderField('Payment hash', decoded.paymentHash, true)}
        ${renderField('Description', decoded.description ?? '--')}
        ${renderField('Description hash', decoded.descriptionHash ?? '--', true)}
        ${renderField('Payee pub key', decoded.payeeNodeKey ?? 'Not included in this invoice')}
        ${renderField('Transaction signature', decoded.signature, true)}
        ${renderField('Recovery flag', decoded.recoveryFlag ?? '--')}
        ${renderField('Minimum final CLTV expiry', decoded.minFinalCltvExpiry ?? '--')}
        ${renderField('Expire time', decoded.expirySeconds)}
        ${renderField('Time expire date', decoded.expiresAt)}
        ${renderField('Time expire date string', `${decoded.expiresAtString}${decoded.expired ? ' (expired)' : ''}`)}
        ${renderField('Timestamp', decoded.timestamp)}
        ${renderField('Timestamp string', decoded.timestampString)}
        ${decoded.unknownTags.length ? `<div class="ld-result__routes"><h4>Unknown tags</h4>${renderUnknownTags(decoded.unknownTags)}</div>` : ''}
        ${decoded.routingInfo.length ? `<div class="ld-result__routes"><h4>Routing hints</h4>${decoded.routingInfo.map(renderRoute).join('')}</div>` : ''}
      </div>
    `;
  };

  const renderInvoiceOnly = (decoded) => {
    if (!decoded) return '';
    if (decoded.type !== 'BOLT11 invoice') return renderDecoded(decoded);
    return renderHighlightedInvoice(decoded);
  };

  const comparisonItems = (original, wrapped, requested = {}) => {
    if (!original || !wrapped || original.type !== 'BOLT11 invoice' || wrapped.type !== 'BOLT11 invoice') return [];

    const hashMatch = Boolean(original.paymentHash && wrapped.paymentHash && original.paymentHash === wrapped.paymentHash);
    const destinationProxied = Boolean(original.signature && wrapped.signature && original.signature !== wrapped.signature);
    const descriptionMatch = (original.description ?? '') === (wrapped.description ?? '');
    const requestedDescriptionMatch = requested.description ? (wrapped.description ?? '') === requested.description : null;
    const wrappedMsats = BigInt(wrapped.amount.millisats || '0');
    const originalMsats = BigInt(original.amount.millisats || '0');
    const feeMsats = wrappedMsats - originalMsats;
    const amountOk = !original.amount.millisats || !wrapped.amount.millisats || feeMsats >= 0n;
    const requestedRoutingMsats = requested.routingMsats ? BigInt(requested.routingMsats) : null;
    const requestedRoutingMatch = requestedRoutingMsats === null || feeMsats === requestedRoutingMsats;

    return [
      {
        key: 'payment_hash',
        label: 'Payment hash',
        ok: hashMatch,
        value: hashMatch ? 'Match' : 'No match',
        detail: hashMatch ? 'The wrapped invoice is locked to the same preimage.' : 'Do not use this wrapped invoice as a replacement for the original.',
        important: true,
      },
      {
        key: 'destination',
        label: 'Destination',
        ok: destinationProxied,
        value: destinationProxied ? 'Proxied' : 'Not proxied',
        detail: destinationProxied ? 'The wrapped invoice signature differs, which indicates a different destination node.' : 'The signatures match. Try a different relay.',
        important: true,
      },
      {
        key: 'description',
        label: requested.description ? 'Requested description' : 'Description',
        ok: requestedDescriptionMatch ?? descriptionMatch,
        value: (requestedDescriptionMatch ?? descriptionMatch) ? 'Match' : 'Different',
        detail: requested.description ? `Expected: ${requested.description}` : 'A different description may be fine only if you expected it.',
      },
      {
        key: 'amount',
        label: 'Wrapped amount',
        ok: amountOk,
        value: amountOk ? 'Same or higher' : 'Lower than original',
        detail: `Extra routing amount: ${feeMsats >= 0n ? feeMsats.toString() : 'negative'} msats`,
      },
      {
        key: 'routing_budget',
        label: 'Requested routing budget',
        ok: requestedRoutingMatch,
        value: requestedRoutingMsats === null ? 'Not requested' : (requestedRoutingMatch ? 'Match' : 'Different'),
        detail: requestedRoutingMsats === null ? 'No routing budget was requested.' : `Expected ${requestedRoutingMsats.toString()} msats; got ${feeMsats.toString()} msats.`,
      },
    ];
  };

  const renderCompare = (original, wrapped, requested = {}) => {
    const items = comparisonItems(original, wrapped, requested);
    if (!items.length) return '';

    const hashItem = items.find((item) => item.key === 'payment_hash');
    const destinationItem = items.find((item) => item.key === 'destination');
    const safeToUse = hashItem?.ok && destinationItem?.ok;
    const statusClass = safeToUse ? 'ld-compare--success' : 'ld-compare--danger';
    const statusTitle = safeToUse ? 'Payment hash match: proxy verification passed' : 'Verification failed: do not trust this wrapper';
    const statusIcon = safeToUse ? '✅' : '⚠️';

    return `
      <div class="ld-compare ${statusClass}">
        <div class="ld-compare__header">
          <div class="ld-compare__icon">${statusIcon}</div>
          <div>
            <h3>${htmlEscape(statusTitle)}</h3>
            <p>${safeToUse ? 'The wrapped invoice appears tied to the original invoice and uses a different destination.' : 'At least one critical check failed. Do not use this wrapped invoice unless you understand why.'}</p>
          </div>
        </div>
        <div class="ld-check-grid">
          ${items.map((item) => `
            <div class="ld-check ${item.ok ? 'ld-check--ok' : 'ld-check--bad'}${item.important ? ' ld-check--important' : ''}">
              <div class="ld-check__status">${item.ok ? '✓' : '×'}</div>
              <div>
                <strong>${htmlEscape(item.label)}: ${htmlEscape(item.value)}</strong>
                <p>${htmlEscape(item.detail)}</p>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  };

  const decodeInto = (root, inputSelector, outputSelector, slot) => {
    const state = getWidgetState(root);
    const input = $(inputSelector, root);
    const output = $(outputSelector, root);

    try {
      const decoded = decodeRequest(input.value);
      state[slot] = decoded;
      output.innerHTML = renderDecoded(decoded);
      if (slot === 'original' && decoded.type === 'BOLT11 invoice') {
        const wrapInput = $('.ld-lnproxy-invoice', root);
        if (wrapInput && !wrapInput.value.trim()) wrapInput.value = decoded.raw;
      }
    } catch (error) {
      state[slot] = null;
      output.innerHTML = `<div class="ld-error">${htmlEscape(error.message)}</div>`;
    }

    const compare = $('.ld-compare-slot', root);
    compare.innerHTML = renderCompare(state.original, state.wrapped, state.lastLnproxyRequest || {});
  };

  const selectRelay = (root) => {
    const state = getWidgetState(root);
    const relayInput = $('.ld-lnproxy-relay', root);
    const relayValue = relayInput?.value.trim();
    if (relayValue) return relayValue;

    const candidates = state.relays.filter((relay) => !state.failedRelays.has(relay));
    const pool = candidates.length ? candidates : state.relays;
    return pool[Math.floor(Math.random() * pool.length)];
  };

  const wrapInvoice = async (root) => {
    const state = getWidgetState(root);
    const invoiceInput = $('.ld-lnproxy-invoice', root);
    const descriptionInput = $('.ld-lnproxy-description', root);
    const routingInput = $('.ld-lnproxy-routing', root);
    const result = $('.ld-lnproxy-output', root);
    const wrappedTextarea = $('.ld-wrapped-input', root);
    const relay = selectRelay(root);

    result.innerHTML = '';
    setBusy(root, true);

    try {
      const original = parseBolt11(invoiceInput.value);
      state.original = original;

      const originalTextarea = $('.ld-original-input', root);
      const originalOutput = $('.ld-original-output', root);
      if (originalTextarea) originalTextarea.value = original.raw;
      if (originalOutput) originalOutput.innerHTML = renderInvoiceOnly(original);

      const payload = { invoice: original.raw };
      const requested = {};

      if (descriptionInput.value.trim()) {
        payload.description = descriptionInput.value.trim();
        requested.description = payload.description;
      }

      if (routingInput.value.trim()) {
        payload.routing_msat = (BigInt(routingInput.value.trim()) * 1000n).toString();
        requested.routingMsats = payload.routing_msat;
      }

      state.lastLnproxyRequest = requested;
      setText('.ld-wrap-status', `Contacting ${relay}...`, root);

      const response = await fetch(relay, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error(`Relay returned HTTP ${response.status}.`);
      const data = await response.json();
      if (data.status === 'ERROR') throw new Error(data.reason || 'Relay returned an error.');
      if (!data.proxy_invoice) throw new Error('Relay did not return a proxy invoice.');

      const wrapped = parseBolt11(data.proxy_invoice);
      state.wrapped = wrapped;
      if (wrappedTextarea) wrappedTextarea.value = wrapped.raw;
      const refreshedOriginalOutput = $('.ld-original-output', root);
      const wrappedOutput = $('.ld-wrapped-output', root);
      if (refreshedOriginalOutput) refreshedOriginalOutput.innerHTML = renderInvoiceOnly(original);
      if (wrappedOutput) wrappedOutput.innerHTML = renderInvoiceOnly(wrapped);
      $('.ld-compare-slot', root).innerHTML = renderCompare(original, wrapped, requested);

      result.innerHTML = `
        <div class="ld-lnproxy-success">
          <div class="ld-lnproxy-success__badge">Wrapped invoice created</div>
          <textarea class="ld-input ld-copy-output" readonly>${htmlEscape(wrapped.raw)}</textarea>
          <div class="ld-action-row">
            <a class="ld-button ld-button--secondary" href="${htmlEscape(wrapped.lightningUri)}">Open in wallet</a>
            <button class="ld-button ld-copy-button" type="button">Copy wrapped invoice</button>
          </div>
        </div>
      `;

      $('.ld-copy-button', result).addEventListener('click', async () => {
        await navigator.clipboard.writeText(wrapped.raw);
        $('.ld-copy-button', result).textContent = 'Copied';
      });
    } catch (error) {
      state.failedRelays.add(relay);
      result.innerHTML = `<div class="ld-error">${htmlEscape(error.message)}</div>`;
    } finally {
      setBusy(root, false);
    }
  };

  const decodeSingle = (root) => {
    const input = $('.ld-single-input', root);
    const output = $('.ld-single-output', root);

    try {
      output.innerHTML = renderDecoded(decodeRequest(input.value));
    } catch (error) {
      output.innerHTML = `<div class="ld-error">${htmlEscape(error.message)}</div>`;
    }
  };

  const boot = (root) => {
    const relayList = $('.ld-relay-list', root);
    DEFAULT_RELAYS.forEach((relay) => {
      const option = document.createElement('option');
      option.value = relay;
      relayList?.appendChild(option);
    });

    const singleButton = $('.ld-decode-single', root);
    const originalButton = $('.ld-decode-original', root);
    const wrappedButton = $('.ld-decode-wrapped', root);
    const wrapButton = $('.ld-wrap-button', root);

    if (singleButton) singleButton.addEventListener('click', () => decodeSingle(root));
    if (originalButton) originalButton.addEventListener('click', () => decodeInto(root, '.ld-original-input', '.ld-original-output', 'original'));
    if (wrappedButton) wrappedButton.addEventListener('click', () => decodeInto(root, '.ld-wrapped-input', '.ld-wrapped-output', 'wrapped'));
    if (wrapButton) wrapButton.addEventListener('click', () => wrapInvoice(root));

    $$('.ld-input', root).forEach((input) => {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          if (input.classList.contains('ld-single-input')) decodeSingle(root);
          if (input.classList.contains('ld-original-input')) decodeInto(root, '.ld-original-input', '.ld-original-output', 'original');
          if (input.classList.contains('ld-wrapped-input')) decodeInto(root, '.ld-wrapped-input', '.ld-wrapped-output', 'wrapped');
          if (input.classList.contains('ld-lnproxy-invoice')) wrapInvoice(root);
        }
      });
    });
  };

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-lightning-decoder-widget]').forEach(boot);
  });
})();

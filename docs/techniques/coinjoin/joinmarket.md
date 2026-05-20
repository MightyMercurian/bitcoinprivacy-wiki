---
description: Explore JoinMarket's decentralized maker-taker CoinJoin model, mixdepth-based privacy, and why it can be the strongest CoinJoin protocol on Bitcoin
---

# JoinMarket

!!! success "Actively Developed: JoinMarket NG"

    Although the [original JoinMarket reference implementation](https://github.com/JoinMarket-Org/joinmarket-clientserver) was archived in April 2026, the protocol is alive and actively developed through [**JoinMarket NG**](https://github.com/joinmarket-ng/joinmarket-ng), a modern, wire-compatible reimplementation. JoinMarket NG inherits the original protocol design, interoperates with legacy peers, and continues to add features (improved tumbler, cold storage fidelity bonds, Neutrino support, new orderbook UI, etc.). This page describes the protocol as a whole and uses JoinMarket NG as the current reference.

JoinMarket is a peer-to-peer marketplace for CoinJoin on Bitcoin. Unlike other CoinJoin implementations that use a coordinator, JoinMarket uses a maker/taker model where participants earn fees for providing liquidity, and the **taker itself constructs the transaction**, talking directly (and end-to-end encrypted) to the makers it has chosen.

!!! info "Other CoinJoin Implementations"

    JoinMarket is one of several CoinJoin implementations. Others include [Whirlpool](whirlpool.md) (5-party, fixed denominations, centralized coordinator) and [Wasabi Wallet](wasabi.md) (WabiSabi protocol, centralized coordinator). Each has different trade-offs in terms of privacy, convenience, and censorship resistance. JoinMarket is the only widely deployed CoinJoin protocol with no central coordinator.

---

## What Is JoinMarket?

JoinMarket is a decentralized CoinJoin protocol where:

- **Makers** advertise their willingness to participate in CoinJoins and earn fees
- **Takers** initiate CoinJoins, choose the makers they want, and pay fees to them

This creates a free market for CoinJoin liquidity, where anyone can earn bitcoin by helping others mix, and takers gain privacy by paying that fee.

!!! tip "The Key Difference: No Coordinator"

    Unlike Whirlpool or Wasabi, JoinMarket has **no central coordinator at all**. The taker selects peers from the public [orderbook](https://joinmarket-ng.sgn.space/) and communicates with them directly over end-to-end encrypted channels, routed through replaceable directory servers (and over Tor). This allows for increased censorship resistance and eliminates a class of attacks that a coordinator could perform.

---

## Why No Coordinator Matters

The absence of a central coordinator is JoinMarket's most important structural property, and it is often understated. A coordinator in other implementations (Wasabi, Whirlpool) sees more than just whether a round happens, and any compromised or malicious coordinator might be able to:

- **Sybil the round**: fill a CoinJoin with itself and one real user, so the "anonymity set" claimed on chain (say, 20+ outputs) is actually 1 vs. the coordinator. This attack is invisible from the outside. This is very difficult with whirlpool however each mix cycle requires a minimum of 2 fresh, fee-paying inputs, making large-scale sybil attacks expensive to run for a prolonged period. This fresh liquidity requirement for each cycle can be verified in the [Whirlpool.Observer Whirlpool cycles table](https://whirlpool.observer/). So the fresh liquidity requirement and free, unlimited remixes is how Whirlpool ensures you can mitigate the consequences of any sybil attack.
- **Link inputs to outputs**: depending on the protocol, the coordinator, if not properly blinded, may see the mapping directly, or may correlate it via timing or IPs.
- **Censor users**: blacklist UTXOs, IPs, or jurisdictions. This has happened in practice with Wasabi.
- **Be coerced**: a single legal target is far easier to subpoena, shut down, or force into surveillance than a swarm of peers.

In JoinMarket, the taker is its own coordinator and never reveals its full input/output set to any single counterparty. Makers see only their inputs and outputs of the specific CoinJoin they participate in, communicate end-to-end encrypted with the taker, and directory servers route messages but cannot read them. There is no privileged party to compromise.

The trade-off is that takers must do more work (peer selection, fee budgeting, [PoDLE](#sybil-resistance-podle) commitments), but in exchange they get the only widely deployed CoinJoin protocol where **the privacy guarantees do not rest on trusting a coordinator**.

---

## JoinMarket Transaction Example

The image below shows a JoinMarket CoinJoin transaction as analyzed by [am-i.exposed](https://am-i.exposed). Notice the 10 equal outputs of 198,732,961 sats (the CoinJoin amount) and 9 change outputs (one per maker; the taker has no change in this example). The CoinJoin amount is taker-chosen and arbitrary, which is exactly what real-world payments look like.

![JoinMarket CoinJoin transaction scanned by am-i.exposed](../../images/joinmarket.png)

---

## How JoinMarket Works

=== "Step 1: Become a Maker or Taker"

    **As a Maker:** You run a maker bot (`jm-maker`) that advertises offers (min/max size, fee schedule) on the orderbook. You earn fees when takers select you as a counterparty.

    **As a Taker:** You run `jm-taker` (or the tumbler), pick a CoinJoin amount and a number of counterparties, and pay fees to the makers who fill your request.

=== "Step 2: Find Counterparties"

    The taker reads the orderbook from one or more replaceable directory servers (over Tor by default) and picks a subset of makers that fit its size and fee budget. Communication is then end-to-end encrypted between taker and each maker; directory servers only route ciphertext.

=== "Step 3: Sybil Resistance via PoDLE"

    Before makers reveal their UTXOs, the taker must commit to ownership of one of its own UTXOs using a [PoDLE](#sybil-resistance-podle) proof. This prevents a free attacker from probing makers' UTXO sets without cost.

=== "Step 4: Construct and Sign"

    The taker assembles the CoinJoin: each participant contributes inputs, receives one equal-amount output (the CoinJoin amount) and, optionally, a change output. Each party signs only their own inputs. The taker never sees the others' keys.

=== "Step 5: Broadcast"

    Once all signatures are collected, the transaction is broadcast to the Bitcoin network. The taker can broadcast itself, or, on Neutrino backends, ask the makers to broadcast simultaneously to avoid leaking its IP.

---

## JoinMarket's Variable Amounts vs fixed denominations

A common debate in CoinJoin design is whether variable amounts or fixed denominations provide better privacy. The honest answer is that they solve different problems and create different trade-offs.

Fixed-denomination systems like Whirlpool have an important privacy advantage: equal-value outputs can continue to build [forward-looking anonymity sets](whirlpool.md#forward-looking-anonymity-sets) over time. If post-mix UTXOs stay in the same denomination and remix, they remain part of a recognizable pool of equal outputs. This can also help with backward-looking analysis, because observers cannot confidently determine which premix input became which postmix output inside a round.

However, fixed denominations also come with practical costs:

- Users must split their balance into pool-sized chunks before mixing (Whirlpool Tx0 Transaction)
- The Tx0 process can create doxxic change that must be handled separately.
- Spending later may require change, multiple UTXOs, or careful post-mix handling.

JoinMarket takes a different approach. The taker chooses the CoinJoin amount freely. This can be useful when the user wants to mix an amount close to a real payment amount, rather than first converting funds into fixed pool denominations.

For example, if someone needs to make a payment of 1.83746 BTC, JoinMarket can allow the taker to choose a CoinJoin amount around that payment size. The equal-output set still provides ambiguity, while avoiding some of the denomination-management problems that fixed-pool systems create.

The trade-off is that variable-amount CoinJoins do not create the same kind of persistent, reusable denomination pool that Whirlpool does. A fixed-denomination model allows equal outputs to remix and grow a [forward-looking anonymity set](whirlpool.md#forward-looking-anonymity-sets). A variable-amount model can be more flexible for specific payment sizes, but the user must still pay close attention to amount matching, change outputs, timing, and post-mix spending.

In short: variable amounts are useful for payment flexibility, while fixed denominations are useful for building durable equal-output anonymity sets. Neither model is automatically superior in every situation. The privacy result depends on how the tool is used and how carefully the user spends afterward.

---

## Mixdepths: Pre-Mix / Post-Mix Separation Done Right

JoinMarket has had a robust pre-mix / post-mix separation **since its earliest versions** in the form of **mixdepths**. JoinMarket is five (by default) isolated sub-accounts arranged as a privacy pipeline.

**Design (default: 5 isolated mixdepths):**

- Each mixdepth is a separate BIP32 account: `m/84'/0'/<mixdepth>'/...`
- Inputs to a CoinJoin always come from **one single mixdepth**
- The CoinJoin output goes to the **next mixdepth**
- Change stays in the **same mixdepth** as the inputs

In practice this means **mixdepth N+1 contains only coins that have been through at least one CoinJoin sourced from mixdepth N**. The deeper a coin is in the mixdepth ladder, the more rounds it has been through, and the larger its effective anonymity set, **including change**, because the change at mixdepth N+1 is itself the change of a CoinJoin whose inputs came from mixdepth N (which themselves were CoinJoined from mixdepth N-1, etc.).

This is an elegant, practical design:

- **Hard wall**: the wallet (`jmwallet`, `jm-taker`, tumbler, maker) refuses to mix UTXOs from different mixdepths in the same transaction.
- **Forward-only flow**: pre-mix lives in low mixdepths, post-mix in higher ones. There is no way to accidentally fund a payment with a freshly deposited UTXO from a high-mixdepth address.
- **Change is privacy-graded**: higher-mixdepth change is also private, since it inherits the anonymity of all previous rounds. This is something Whirlpool's "bad bank" model does not offer.

!!! tip "Practical mixdepth hygiene"

    - Deposit fresh funds into mixdepth 0.
    - Use the [tumbler](#why-you-should-use-the-tumbler) (or several taker rounds) to walk coins through mixdepths 0 → 1 → 2 → ... toward your destination.
    - Pay external destinations from the **highest mixdepth** you have available.
    - Never manually merge UTXOs across mixdepths.

---

## Privacy Analysis: What Can and Cannot Be Deanonymized

JoinMarket's privacy properties have been studied in detail, and it is important to be precise about what is and is not vulnerable.

### What is ambiguous (the equal outputs)

The equal-amount outputs of a JoinMarket CoinJoin are the actual privacy product. They are bitwise indistinguishable on chain, and within a single CoinJoin **the mapping from inputs to equal outputs is not determined by the amounts**. This is the same fundamental CoinJoin property that Whirlpool and Wasabi rely on.

### What is identifiable (the change)

What is identifiable, in a single CoinJoin, is the **change outputs**, not the equal outputs. Each maker has its own change amount, computed from its input value minus the CoinJoin amount minus fees. Knowing each maker's input amount and the CoinJoin amount lets an analyzer recover which input goes with which change.

This is what tools like the [JoinMarket Analyzer](https://github.com/m0wer/joinmarket_analyzer) do, using a combination of greedy matching and Integer Linear Programming: they recover the input-to-change mapping (and therefore identify the taker, who in a simple single round may have no change or has a distinct change pattern). Crucially, they **do not** break the input-to-equal-output mapping inside a single CoinJoin.

So the practical guidance is:

- The **equal outputs** of a JoinMarket CoinJoin do provide CoinJoin-quality ambiguity.
- The **change outputs** of a single CoinJoin are correlatable to their input, and so are not on their own a privacy gain.
- **Mixdepths fix this for change too**: change at mixdepth N+1 was itself produced by a CoinJoin at mixdepth N, so it has been mixed at least once. As you climb mixdepths, both equal outputs and change accumulate privacy.

### The historical "jm_unmixer" caveat

A 2016 Bitcointalk tool ([jm_unmixer](https://bitcointalk.org/index.php?topic=1609980.00)) claimed to "unmix" 40-54% of single JoinMarket CoinJoins by exploiting maker output reuse across transactions. The relevant lesson is not that JoinMarket is broken, but that:

1. **Single CoinJoins are weak** in any protocol; you need multiple rounds.
2. **Maker behavior over time matters**: a maker that reuses outputs leaks information about itself, but this attack identifies makers/takers in single rounds, it does not retroactively link well-tumbled coins.
3. The **tumbler** (multiple consecutive rounds across mixdepths, with random amounts and timing) is precisely what eliminates this leakage.

JoinMarket developers have always recommended the tumbler for serious privacy. See [Why You Should Use the Tumbler](#why-you-should-use-the-tumbler) below.

---

## Sybil Resistance (PoDLE)

A naive open marketplace would be trivially Sybil-able: an attacker could spin up dozens of fake makers to fill its own rounds. JoinMarket prevents this with two layered mechanisms.

### PoDLE commitments

Before a maker reveals its UTXOs to a taker, the taker must publish a **PoDLE** (Proof of Discrete Log Equivalence) commitment to one of its own UTXOs (with minimum confirmations and minimum value relative to the CoinJoin amount). Each UTXO can produce only a small number of valid commitments. This means:

- A free attacker probing makers' UTXO sets is forced to commit real UTXOs and burn them on retries.
- Used commitments are broadcast to all makers (`!hp2`) so an attacker cannot reuse them across the network.

### Fidelity bonds

Makers can publicly lock bitcoin in timelocked UTXOs ([fidelity bonds](../../glossary.md#fidelity-bond)) to gain priority in taker selection. The economic weight of a bond scales with both amount and lock duration. A Sybil attacker would need to lock bitcoin at scale to compete with honest bonded makers, which makes large-scale Sybiling very expensive. The new orderbook UI even computes the protocol-feature share **over bonded makers only**, so Sybils are excluded from network statistics.

---

## JAM and the JoinMarket NG TUI

For a long time, JoinMarket required a comfortable command-line workflow. Two projects materially lower this barrier:

- **[JAM](https://github.com/joinmarket-webui/jam)** is a web UI for the original JoinMarket and works against any wire-compatible backend, including JoinMarket NG. It offers point-and-click wallet management, taker rounds, and maker control through a browser.
- **JoinMarket NG TUI** is a built-in terminal UI shipped with `jm-walletd`, suitable for headless servers and people who prefer keyboard-driven interfaces.

Even with these, JoinMarket asks more of the user than a coordinator-based wallet: you set fee budgets, you manage mixdepths. That is the cost of removing the coordinator from the trust model, and it is well spent.

---

## Why You Should Use the Tumbler

!!! danger "Single CoinJoins Are Not Enough"

    **Do not rely on a single `jm-taker coinjoin` for serious privacy.** As discussed in [Privacy Analysis](#privacy-analysis-what-can-and-cannot-be-deanonymized), the equal outputs of a single CoinJoin are ambiguous, but the change outputs are not, and historical analyses (jm_unmixer and modern ILP-based analyzers) can fingerprint takers in single rounds. Use the [tumbler](../../glossary.md#tumbler) to walk coins through multiple mixdepths over time.

??? tip "What the tumbler does"

    The tumbler (`jm-tumbler` in JoinMarket NG) is a scheduler that turns a wallet and a list of destination addresses into a multi-phase plan:

    1. **Multiple rounds across mixdepths**: each phase advances funds to the next mixdepth via a taker CoinJoin, accumulating privacy at each step.
    2. **Random amounts**: phase amounts are randomized so amount-matching analysis across rounds does not work.
    3. **Random timing**: rounds are spaced with random delays to break timing correlation.
    4. **Multiple destination addresses**: outputs are split across at least 3 destinations (the CLI treats fewer as a development-only mode), so the exit pattern is not itself a fingerprint.
    5. **Optional maker phases**: the tumbler can interleave maker sessions, so the same wallet appears on chain sometimes as a taker and sometimes as a maker, blurring the role.
    6. **Persistent plans**: plans are stored as YAML and can be paused, inspected, or resumed (`jm-tumbler run --resume`).

??? quote "From the developers"

    The original JoinMarket developers were always explicit about this. As waxwing put it on the 2016 Bitcointalk thread:

    > "Of course; that's why the tumbler script exists. A single coinjoin serves only to confuse automated wallet closure analysis, and to generally improve the health of Bitcoin's privacy... Whenever possible we have tried to make this clear."

    JoinMarket NG keeps that recommendation and ships an improved tumbler with resumable plans and maker-phase interleaving.

---

## JoinMarket Fees

Makers set their own fees (a mix of absolute and relative components). Takers see the full offer set and pick within their budget. The current public orderbook is:

- **JoinMarket NG orderbook**: <https://joinmarket-ng.sgn.space/>

The orderbook shows offers, fidelity bond values, supported protocol features, and (importantly) computes bond-share statistics over bonded makers only, so Sybil makers do not skew the picture.

!!! tip "Earn Bitcoin as a Maker"

    Running a maker bot (`jm-maker start`) earns fees while you sleep and improves the network's anonymity set for everyone. It is one of the few ways to earn bitcoin "yield" without giving up custody, and it directly supports the privacy of other users.

---

## JoinMarket Best Practices

<div class="grid cards" markdown>

-   :material-server:{ .lg .middle } __Run Your Own Maker Bot__

    ---

    Earns bitcoin and grows the network's liquidity, which directly helps everyone's anonymity set.

-   :material-incognito:{ .lg .middle } __Always Use Tor__

    ---

    JoinMarket supports Tor natively (taker, maker, directory connections). Use it.

-   :material-shuffle:{ .lg .middle } __Use the Tumbler, Not Single Rounds__

    ---

    Multiple rounds across mixdepths are what produces real privacy.

-   :material-layers-triple:{ .lg .middle } __Respect Mixdepths__

    ---

    Never manually merge UTXOs across mixdepths. Spend payments from the highest mixdepth you have.

-   :material-hand-back-right-off:{ .lg .middle } __Never Spend Post-Mix Together__

    ---

    Each post-mix output should be spent independently to preserve its anonymity set.

-   :material-shield-check:{ .lg .middle } __Use a Dedicated Wallet__

    ---

    Keep your JoinMarket wallet separate from your day-to-day spending wallet.

-   :material-lock-clock:{ .lg .middle } __Anonymize Bonds Before Locking__

    ---

    Fidelity bond UTXOs are public. Mix them first, then lock; otherwise you tie your maker identity to their history.

-   :material-clock:{ .lg .middle } __Be Patient__

    ---

    Finding good counterparties takes time. Let the tumbler schedule rounds, do not rush them.

</div>

---

## JoinMarket vs Other CoinJoin Implementations

| Feature | JoinMarket (NG) | Whirlpool | Wasabi |
|---------|-----------|-----------|--------|
| **Coordinator** | None (true P2P) | Centralized | Centralized |
| **Denominations** | Variable (taker chooses) | Fixed pools | Variable (WabiSabi) |
| **Fees** | Taker pays makers (market) | Pay coordinator | Pay coordinator |
| **Sybil resistance** | PoDLE + fidelity bonds | Fresh premixers (and [free remixes](whirlpool.md#forward-looking-anonymity-sets)) make prolonged Sybil attacks infeasible | Trust coordinator |
| **Pre/Post-mix separation** | Enforced by mixdepths (5 by default) | Enforced by accounts | Enforced by accounts |
| **Change privacy** | Improves with mixdepth | "Bad bank" / doxxic | Depends on round and often ground down to near dust due to Change subdivision |
| **Censorship resistance** | High | Low | Low |
| **Anonymity set per round** | Configurable (typ. 9-11) | 5-8 | Variable |
| **Forward-looking anonymity set** | None (due to variable amounts) | [Exponential](whirlpool.md#forward-looking-anonymity-sets) | Exponential |
| **Status** | Actively developed (JoinMarket NG) | Actively Developed by Ashigaru | Active |

---

## Common JoinMarket Mistakes

=== "Doing single CoinJoins instead of tumbling"

    A single round leaves identifiable change and exposes you to amount-matching across maker history. Use the tumbler.

=== "Spending payments from low mixdepths"

    Coins in mixdepth 0 are unmixed by definition (unless they've circled back). Pay from the highest mixdepth you have; tumble more if you need to.

=== "Not running a maker"

    Only takers means no liquidity. If you can spare bitcoin and uptime, run a maker; you earn fees and you help the network. COmbining roles helps your privacy too.

=== "Locking unmixed UTXOs as fidelity bonds"

    Bonds are public on directories. If you lock a bond UTXO with a doxxic history, your maker identity inherits that history. Mix the funds first, then bond.

---

## Post-Mix Management

JoinMarket post-mix UTXOs (high-mixdepth coins) require the same care as any CoinJoin output:

- **Never mix post-mix with unmixed coins**: mixdepth separation prevents this by default; do not override it manually.
- **Avoid consolidation**: combining post-mix UTXOs reduces the anonymity set to the intersection of the combined UTXOs. Spend them independently when possible.

For broader post-mix guidance that applies across CoinJoin implementations, see the [Whirlpool post-mix section](whirlpool.md#how-to-manage-postmix); the principles transfer to JoinMarket directly.

---

## References

- [JoinMarket NG repository](https://github.com/joinmarket-ng/joinmarket-ng) - actively developed reimplementation of the protocol
- [JoinMarket NG documentation](https://joinmarket-ng.github.io/joinmarket-ng/) - install, configuration, technical details
- [JoinMarket NG orderbook](https://joinmarket-ng.sgn.space/) - live orderbook and maker statistics
- [JAM (JoinMarket Web UI)](https://github.com/joinmarket-webui/jam) and [JAM docs](https://jamdocs.org)
- [JoinMarket Analyzer](https://github.com/m0wer/joinmarket_analyzer) - research tool for analyzing JoinMarket CoinJoin transactions (ILP-based input-to-change matching)
- [Original JoinMarket reference implementation (archived)](https://github.com/JoinMarket-Org/joinmarket-clientserver)
- [Loïc Morel's Educational Content](https://pandul.fr/) - Bitcoin privacy tutorials and guides

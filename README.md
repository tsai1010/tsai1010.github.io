# MidiSynth Routing Composer

Routing Composer is an optional GUI and preset-based routing engine for **MidiSynth**.  
It allows web developers to define, load, and lock audio routing chains using JSON, while keeping full control over audio initialization and MIDI message sources.

This project is designed for **web-based audio applications**, including interactive instruments, generative music systems, and embedded sound engines.

---

## Quick Start

### 1️⃣ Initialize Audio (Required)

Due to browser autoplay policies, an `AudioContext` **must be created or resumed inside a user interaction** (for example, a button click).

```js
async function initAudio() {
  const ctx = new AudioContext();

  const midi_synth = new window.MidiSynth();
  midi_synth.setAudioContext(ctx, ctx.destination);

  return midi_synth;
}
```

> ⚠️ `enableRoutingComposer()` does **not** create an `AudioContext`.  
> This is intentional, allowing developers to fully control when and how audio is initialized.

---

### 2️⃣ Enable Routing Composer (GUI Mode)

Attach the Routing Composer GUI to a button or DOM container:

```js
const midi_synth = await initAudio();

await midi_synth.enableRoutingComposer({
  button: "#composer-slot",
  tailwind: "auto",
});
```

This enables an interactive routing editor for end users.

---

### 3️⃣ Embedded / Preset-Only Mode (No GUI)

Use Routing Composer as a **preset-based routing engine**, without exposing any GUI controls:

```js
const midi_synth = await initAudio();

await midi_synth.enableRoutingComposer({
  showButton: false,
  loadURL: {
    url: "/presets/all-chains.json",
    locked: true,
  },
});
```

In this mode:

- The routing engine is active
- MIDI-style messages still produce sound
- End users cannot modify the routing graph

---

## Loading Routing Presets

### Load All Chains from a Single JSON File

```js
await midi_synth.enableRoutingComposer({
  showButton: false,
  loadURL: "/presets/all-chains.json",
});
```

---

### Load All Chains with Lock Policy

```js
await midi_synth.enableRoutingComposer({
  showButton: false,
  loadURL: {
    url: "/presets/all-chains.json",
    locked: [true, false, true],
    names: ["Main", "Lead", "Pad"],
  },
});
```

**Locking behavior**

- Locked chains cannot be edited via the GUI
- Mute / Export / Duplicate remain available

---

### Load Individual Chains (Modular Presets)

Each chain can be loaded from a separate JSON file:

```js
await midi_synth.enableRoutingComposer({
  showButton: false,
  loadChains: [
    { idx: 0, url: "/presets/main.json", name: "Main", locked: true },
    { idx: 1, url: "/presets/lead.json", name: "Lead" },
    { idx: 2, url: "/presets/pad.json",  name: "Pad", locked: true },
  ],
});
```

Notes:

- `idx` is the chain index (0-based)
- Chains are automatically expanded if needed

---

## Sending MIDI-Style Messages

Routing Composer does **not** require a physical MIDI device.

Any source that produces standard MIDI byte messages can be used:

```js
midi_synth.send([0x90, 60, 100]); // Note On
midi_synth.send([0x80, 60, 0]);   // Note Off
```

Using Web MIDI API or hardware MIDI ports is optional and left to the application developer.

---

## Full `enableRoutingComposer()` Options

```ts
enableRoutingComposer({
  button?: string | HTMLElement,
  tailwind?: 'auto' | boolean,
  showButton?: boolean,

  loadURL?: string | {
    url: string,
    locked?: boolean | boolean[],
    names?: string[],
  },

  loadChains?: Array<{
    idx: number,
    url: string,
    locked?: boolean,
    name?: string,
    mute?: boolean,
  }>,

  initialState?: {
    chains: any[],
    chainMeta?: any[],
    mutes?: boolean[],
  },

  onChange?: (state) => void,
});
```

---

## Design Notes

- Routing Composer processes **MIDI message data**, not MIDI devices
- Audio initialization is intentionally decoupled from routing and GUI
- Presets can be fully locked to prevent accidental modification
- GUI usage is optional; the routing engine can run headlessly

---

## License

MIT License (or project-specific license)

# Web-based Physical Modeling Synthesizer

## GUI Version
You can also use a version with built-in GUI for controlling parameters such as volume, ADSR, reverb, chorus, and more.  
👉 [**Live Demo here**](https://tsai1010.github.io/index-gui.html)

### Load
Load it directly from the CDN:  
```html
<script type="module">
  import MidiSynth from 'https://tsai1010.github.io/scripts/midisynth-gui.js';
</script>
```

### Example: Attach GUI to an HTML element
The following example shows how to initialize the synth only after the first user interaction (required by browsers),  
and how to attach the GUI panel to an existing element using `enableRoutingComposer()` (available only in the GUI version).

```js
async function initAudio() {
  if (!ctxStart) {
    // ⚡ Create AudioContext only after first user interaction
    ctx = new AudioContext();
    midi_synth = new window.MidiSynth();
    midi_synth.setAudioContext(ctx, ctx.destination);
    ctxStart = true;
    console.log("AudioContext 1.0 started:", ctx);

    // ✅ This function exists only in the GUI version
    if (typeof midi_synth.enableRoutingComposer === "function") {
      await midi_synth.enableRoutingComposer({
        button: '#composer-slot',
        tailwind: 'auto',
      });
    } else {
      console.log("Non-GUI version detected, skipping Routing Composer setup.");
    }

  } else if (ctx.state === "suspended") {
    ctx.resume().then(() => {
      console.log("AudioContext resumed");
    });
  }

  window.synth = midi_synth;
}

// Bind interaction events
document.addEventListener("click", initAudio, { once: false });
document.addEventListener("touchstart", initAudio, { once: false });
```

You can place a target `<div>` or button in your HTML:
```html
<div id="composer-slot"></div>
```

When the user first interacts (click/touch), the GUI panel will appear inside the target element.

### Notes
* The GUI version internally uses **React** and **Tailwind CSS** for rendering.
  - If your project already includes React and Tailwind, the GUI will automatically use your existing versions.
  - If not, it will dynamically load lightweight standalone builds at runtime.
* The GUI version includes the same sound engine as `midisynth.js`.
* You can access the engine directly via `synthGUI.engine`.
* All functions such as `send()`, `reset()`, and `setMasterVol()` remain available.
* The GUI layout is responsive and works on both desktop and tablet browsers.
* 👉 Try the live demo: [tsai1010.github.io/index-gui.html](https://tsai1010.github.io/index-gui.html)


---

## Load (Engine Only)
* load it from a CDN:  
  ```html
  <script type="module">
    import MidiSynth from 'https://tsai1010.github.io/scripts/midisynth.js';
  </script>
  ```
* create a new synth:  
  ```js
  synth = new window.MidiSynth();
  ```

## Functions
### send([midi-message], t)  
midi-message is an array of midi data-bytes for one message.

### reset()  
Reset all channel to initial state, including all controllers, program, chVol, pan and bendRange.

### setMasterVol(value)  
Master volume setting. default=0.3. Range: 0~1

### setA4freq(value)  
A4 frequency setting. it's used for convert note-number to frequency.

### resetAllControllers(ch)  
Control parameters of specified channel are reset.

---

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

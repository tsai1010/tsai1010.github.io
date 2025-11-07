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

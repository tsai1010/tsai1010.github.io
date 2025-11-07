# Web-based Physical Modeling Synthesizer

## GUI Version
You can also use a version with built-in GUI for controlling parameters such as volume, ADSR, reverb, chorus, and more.

### Load
Load it directly from the CDN:  
```html
<script type="module">
  import MidiSynthGUI from 'https://tsai1010.github.io/scripts/midisynth-gui.js';
</script>
```

### Create and Attach
Create a new GUI synth and attach it to a specific <div>:
```html
<div id="synth-container"></div>
<script>
  const synthGUI = new MidiSynthGUI();
  synthGUI.attachTo(document.getElementById('synth-container'));
</script>
```

Or let it automatically create a floating control panel:
```js
const synthGUI = new MidiSynthGUI({ autoAppend: true });
```

### Notes
* The GUI version includes the same sound engine as `midisynth.js`.
* You can access the engine directly via `synthGUI.engine`.
* All functions such as `send()`, `reset()`, and `setMasterVol()` remain available.
* The GUI layout is responsive and works on both desktop and tablet browsers.

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

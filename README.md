# Web-based Physical Modeling Synthesizer
## Load
* load it from a CDN:  
      ```<script type="module"> import MidiSynth from 'https://tsai1010.github.io/scripts/midisynth.js'; </script>```
* create a new synth:  
        ```synth = new window.MidiSynth();```
## Functions
### send([midi-message], t)  
      midi-message is an array of midi data-bytes for one message.
### reset()  
      Reset all channel to initial state. Including all controllers, program, chVol, pan and bendRange.
### setMasterVol(value)  
      Master volume setting. default=0.3. Range: 0~1
### setA4freq(value)  
      A4 frequency setting. it's used for convert note-number to frequency.
### resetAllControllers(ch)  
      Control parameters of specified channel are reset.

# Interactive Timbre Explorer

An interactive timbre exploration demo built with MidiSynth and Routing Composer.

This demo allows users to explore pitch, timbre, and rhythmic variations through direct mouse interaction:

- Vertical movement controls pitch
- Horizontal movement controls Karplus–Strong smoothing
- The center region produces faster arpeggiated patterns
- Press and hold the mouse button to generate sound

The visual system is adapted from:

"Opposing Forces – Sonic Collision"
https://codepen.io/8binami/pen/NPRwPOd

Original visual concept and particle system by David 8binami Team.
Used and modified under the MIT License.

Modifications include:
- Replacement of the original ChiptuneSynth audio engine
- Integration with MidiSynth
- Karplus–Strong physical modeling synthesis
- Runtime graph editing through Routing Composer
- MIDI-based arpeggiated interaction system
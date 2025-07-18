window.AudioContext = window.AudioContext || window.webkitAudioContext;

const ctx = new AudioContext();
let ctxStart = false;

let inputs;
const midiInputs = {};

const startAudio = document.querySelector('body');
const oscSet = {};

let midi_synth;



startAudio.addEventListener('click', ()=>{
    if (ctx.state === 'suspended') {
        ctx.resume();
    }
    if(ctxStart==false){
        // ctx = new AudioContext;
        ctxStart = true;
        // ctx.audioWorklet.addModule('scripts/karplus-strong-processor.js');
        // ctx.audioWorklet.addModule('scripts/highpass-processor.js');
        // ctx.audioWorklet.addModule('scripts/lowpass-processor.js');
        // ctx.audioWorklet.addModule('scripts/karplus-echo-processor.js');
        midi_synth = new window.MidiSynth();
        midi_synth.setAudioContext(ctx, ctx.destination);
        console.log(ctx);
    }
    



})

function setMasterV(value){
    midi_synth.setMasterVol(value);
}

function setA4(value){
    midi_synth.setA4freq(value);
}

function miditoFreq(midiNumber){
    return A4_freq * (2 ** ((midiNumber - 69) / 12.0));
}

function frequencyToPeriod(freq) {
    return freq > 0 ? 1 / freq : 0.0002;
  }

if(navigator.requestMIDIAccess){
    navigator.requestMIDIAccess().then(success, failure);
}

function success(midiAccess){
    inputs = midiAccess.inputs;
    let midiPort = document.getElementById("midiInputPort");
    inputs.forEach((input)=>{
        console.log(input);
        if(!midiInputs[input.name]) {
            midiInputs[input.name] = input;
            midiPort.innerHTML += "<option value=\"" + input.name + "\">" + input.name + "</option>";
            console.log("input.name", input.name);
        }
        if(allPort) input.onmidimessage = handleInput;
    })

}

function setPort(portName){
    inputs.forEach((input)=>{
        input.onmidimessage = null;
    })

    inputs.forEach((input)=>{
        if(portName === "all") input.onmidimessage = handleInput;
        else if(portName == input.name) {
            input.onmidimessage = handleInput;
            // console.log("port:", input.name);
        }
    })
}


// function karplusStrong(noteFreq, duration = 2, harmonics = 0.5) {
//     const sampleRate = ctx.sampleRate;
//     const bufferSize = Math.floor(sampleRate / noteFreq);
  
//     // Create a buffer with white noise
//     const noiseBuffer = ctx.createBuffer(1, bufferSize, sampleRate);
//     const noiseData = noiseBuffer.getChannelData(0);
//     for (let i = 0; i < bufferSize; i++) {
//       // Add more high frequency content for stronger harmonics
//       noiseData[i] = (Math.random() * 2 - 1) * (1 - harmonics) + (Math.random() * harmonics);
//     }
  
//     const noiseSource = ctx.createBufferSource();
//     noiseSource.buffer = noiseBuffer;
//     noiseSource.loop = true;
  
//     // Delay node for the Karplus-Strong loop
//     const delay = ctx.createDelay();
//     delay.delayTime.value = bufferSize / sampleRate;
  
//     const feedback = ctx.createGain();
//     feedback.gain.value = 0.998; // feedback slightly less than 1
  
//     const damping = ctx.createGain();
//     damping.gain.value = 0.5; // simple damping factor to replace filter
  
//     const outputGain = ctx.createGain();
//     outputGain.gain.setValueAtTime(0.2, ctx.currentTime);
//     outputGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration); // decay envelope
  
//     // Connect the Karplus-Strong loop
//     noiseSource.connect(delay);
//     delay.connect(damping);
//     damping.connect(feedback);
//     feedback.connect(delay);
  
//     // Connect to destination
//     damping.connect(outputGain).connect(ctx.destination);
  
//     noiseSource.start();
//     noiseSource.stop(ctx.currentTime + duration);
//   }
  

async function loadKarplusStrong(freq = 110, duration = 12, harmonics = 0.5, lowpassFreq = 2000, dst = ctx.destination) {
    await ctx.audioWorklet.addModule('scripts/karplus-strong-processor.js');
  
    const node = new AudioWorkletNode(ctx, 'karplus-strong-processor');
  
    // Insert lowpass filter before feedback (simulating noise -> lowpass -> delay/feedback)
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(lowpassFreq, ctx.currentTime);
    lowpass.Q.value = 0.404;

    const lowpass1 = ctx.createBiquadFilter();
    lowpass1.type = 'lowpass';
    lowpass1.frequency.setValueAtTime(3500, ctx.currentTime);
    lowpass1.Q.value = 0.45;

    const lowpass2 = ctx.createBiquadFilter();
    lowpass2.type = 'lowpass';
    lowpass2.frequency.setValueAtTime(3500, ctx.currentTime);
    lowpass2.Q.value = 0.45;

    const lowpass3 = ctx.createBiquadFilter();
    lowpass3.type = 'lowpass';
    lowpass3.frequency.setValueAtTime(3500, ctx.currentTime);
    lowpass3.Q.value = 0.45;
  
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  
    // Reconnect: node -> lowpass -> gain -> output
    node.connect(lowpass).connect(lowpass1).connect(lowpass2).connect(lowpass3).connect(dst);
  
    node.port.postMessage({
      freq,
      sampleRate: ctx.sampleRate,
      harmonics,
      lowpass: true // optional flag if the processor also supports filter control
    });
  }
  




function handleInput(input){
    const command = input.data[0] >> 4;
    const channel = input.data[0] & 0xf;
    const note = input.data[1];
    const velocity = input.data[2];

    if(playInput)
        midi_synth.send(input.data);

    console.log(`command: ${command}, channel: ${channel}, note: ${note}, velocity: ${velocity}`);

    if(note>20&&note<109){
        if(command==8) {
            keyOff(document.getElementsByClassName(midiToId[note])[0], note);
        }
        else if(command==9) {
            if(velocity==0) {
                keyOff(document.getElementsByClassName(midiToId[note])[0], note);
            }
            else {
                if (channelFilter[channel]==1) {
                    keyOn(document.getElementsByClassName(midiToId[note])[0], note, velocity, channel);
                }
                
            }
        }
    }
    
    
}

function synthOn(n, v){
    if(!oscSet[n.toString()]){
        oscSet[n.toString()] = 1;
        midi_synth.send([0x91, n, v]);
    }
    
}

function synthOff(n){
    if(oscSet[n.toString()]){
        midi_synth.send([0x81, n]);
        delete oscSet[n.toString()];
    }
    
}



function createWhiteNoiseBuffer(context){
    const bufferSize = 2 * context.sampleRate; // 2秒的聲音
    const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1; // 介於 -1 和 1 之間的隨機值
    }
    return buffer;
}


function noteOn(note, velocity, harmonics=0){
    // karplusStrong(miditoFreq(note), 2, 0.5);

    

    if(!oscSet[note.toString()]){

        // ctx.resume();
        

        const node = new AudioWorkletNode(ctx, 'karplus-strong-processor');
        const freq = miditoFreq(note);
        // node.connect(ctx.destination);

        oscSet[note.toString()] = node;

        node.port.postMessage({
            freq,
            sampleRate: ctx.sampleRate,
            harmonics,
            lowpass: true // optional flag if the processor also supports filter control
        });



        const noteFreq = miditoFreq(note);
        const sampleRate = ctx.sampleRate;
        const bufferSize = Math.floor(sampleRate / noteFreq);
  
        // Create a buffer with white noise
        const noiseBuffer = ctx.createBuffer(1, bufferSize, sampleRate);
        const noiseData = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
        // Add more high frequency content for stronger harmonics
            noiseData[i] = Math.random() * 2 - 1;
        }


        const noiseSource = ctx.createBufferSource();
        // noiseSource.buffer = createWhiteNoiseBuffer(ctx);
        noiseSource.buffer = noiseBuffer;
        // noiseSource.loop = true;

        

        // const buffer = createWhiteNoiseBuffer(ctx);
        // const whiteNoiseSource = ctx.createBufferSource();

        // -----------------------------------
        const n1 = ctx.createBiquadFilter();
        const n2 = ctx.createBiquadFilter();
        const low1 = ctx.createBiquadFilter();
        const low2 = ctx.createBiquadFilter();
        const low3 = ctx.createBiquadFilter();
        
        const high3 = ctx.createBiquadFilter();
        const high4 = ctx.createBiquadFilter();

        

        // whiteNoiseSource.buffer = buffer;
        // whiteNoiseSource.loop = true;
        let {currentTime} = ctx;
        

        const velocityAmount = (velocity-1)/126;
        const lowFreq = miditoFreq((50*velocityAmount**1.25)+70);
        const noiseFreq = miditoFreq(note);
        
        const totalGain = ctx.createGain();
        const noiseGain = ctx.createGain();
        const delGain = ctx.createGain();
        const oscGain = ctx.createGain();

        const feedback = new DelayNode(ctx, {
            delayTime: frequencyToPeriod(noiseFreq),
            maxDelayTime: 0.05,
          });
        const fbLow1 = ctx.createBiquadFilter();
    

        totalGain.gain.value = totalAudioValue;
        noiseGain.gain.value = 0;
        delGain.gain.value = 1;
        oscGain.gain.value = 1;
        // feedback.delayTime.value = frequencyToPeriod(noiseFreq);
        console.log("Period:", feedback.delayTime.value);
        console.log("noiseFreq:", noiseFreq);

        n1.type = "lowpass";
        n1.frequency = 500;

        n2.type = "lowpass";
        n2.frequency = lowFreq;
        n2.Q = 0.404;

        low1.type = "lowpass";
        low1.frequency = 3500;
        low1.Q = 0.45;

        low2.type = "lowpass";
        low2.frequency = 3500;
        low2.Q = 0.45;

        low3.type = "lowpass";
        low3.frequency = 3500;
        low3.Q = 0.45;

        const high1 = new AudioWorkletNode(ctx, 'highpass-processor');
        high1.parameters.get('cutoff').setValueAtTime(noiseFreq/2, ctx.currentTime);

        const high2 = new AudioWorkletNode(ctx, 'highpass-processor');
        high2.parameters.get('cutoff').setValueAtTime(20, ctx.currentTime);

        fbLow1.type = "lowpass";
        fbLow1.frequency = 6000;


        high3.type = "highpass";
        high3.frequency = 100;

        high4.type = "highpass";
        high4.frequency = 3;

        

        



        const damping = ctx.createGain();
        damping.gain.value = 0.998; // simple damping factor to replace filter
  
        const outputGain = ctx.createGain();
        outputGain.gain.setValueAtTime(0.996, ctx.currentTime);
        outputGain.gain.exponentialRampToValueAtTime(0.95, ctx.currentTime + 20); // decay envelope

        // noiseGain.connect(n1).connect(n2).connect(low1).connect(low2).connect(low3).connect(high1).connect(high2);

        // noiseGain.connect(n1).connect(n2).connect(high1).connect(high2);


        const lowpassNode = new AudioWorkletNode(ctx, 'lowpass-processor');
        lowpassNode.parameters.get('cutoff').setValueAtTime(500, ctx.currentTime);

        const lop1 = new AudioWorkletNode(ctx, 'lowpass-processor');
        lop1.parameters.get('cutoff').setValueAtTime(6000, ctx.currentTime);

        const lop2 = new AudioWorkletNode(ctx, 'lowpass-processor');
        lop2.parameters.get('cutoff').setValueAtTime(20000, ctx.currentTime);

        const highpassNode = new AudioWorkletNode(ctx, 'highpass-processor');
        highpassNode.parameters.get('cutoff').setValueAtTime(100, ctx.currentTime);

        const node2 = new AudioWorkletNode(ctx, 'karplus-echo-processor');
        node2.port.postMessage({ freq: noiseFreq });

        // noiseGain.connect(n1).connect(n2).connect(low1).connect(low2).connect(low3).connect(high1).connect(high2);

        // noiseSource.connect(noiseGain).connect(lowpassNode).connect(n2).connect(low1).connect(low2).connect(low3).connect(high1).connect(node2).connect(totalGain);
        
        noiseSource.connect(noiseGain).connect(lowpassNode).connect(node2).connect(totalGain);


        // low3.connect(feedback).connect(delGain).connect(lop2).connect(lop1).connect(feedback);
        // low3.connect(totalGain);
        // lop1.connect(totalGain);

        // feedback.connect(damping);
        // delGain.connect(feedback);
        // damping.connect(outputGain);
        // damping.connect(delGain);
        // outputGain.connect(oscGain);
        // fbLow1.connect(damping);
        
        // lop1.connect(oscGain);

        // oscGain.connect(high3).connect(hip4).connect(totalGain);
        
        totalGain.connect(ctx.destination);

        // loadKarplusStrong(miditoFreq(note), 2, 0.8, miditoFreq((50*((velocity-1)/126)**1.25)+70), totalGain);
        

        noiseSource.start();
        noiseGain.gain.exponentialRampToValueAtTime(2, currentTime + 0.002);
        noiseGain.gain.exponentialRampToValueAtTime(0.0000001, currentTime + 0.242);
        lowpassNode.parameters.get('cutoff').exponentialRampToValueAtTime(9, currentTime + 0.242);
        // n1.frequency.exponentialRampToValueAtTime(9, currentTime + 0.242);
        // noiseSource.stop(currentTime + 5);

        noiseSource.gain = noiseGain;
        noiseSource.delGain = delGain;
        noiseSource.feedback = feedback;
       
        oscSet[note.toString()] = noiseSource;
        
    }
    
}

function noteOff(note){
    if(oscSet[note.toString()]){
        let osc = oscSet[note.toString()];
        // osc.decay = 0.7;

        // const delGain = osc.delGain;

            
        // let {currentTime} = ctx;
        // delGain.gain.linearRampToValueAtTime(0.95, currentTime + 0.01);

        delete oscSet[note.toString()];
       

        setTimeout(()=>{
            osc.stop();
            osc.disconnect();
            // delGain.disconnect();
        }, 12000)
        
    
        
    }
}

function failure(){
    console.log("failure");
}


function harmonicCreate(note, freq, velValue, type, inHarmonic, filter){
    const harmonicSet = [];
    let ratioIndex = type*8;
    let osc_freq;
    for(let h = 1; h < harmonic + 1; h++) {
        // const osc = ctx.createOscillator();
        // const oscGain = ctx.createGain();
        // const velocityGain = ctx.createGain();
        // const bandPassFilter = ctx.createBiquadFilter();

        // let {currentTime} = ctx;

        // oscGain.gain.value = totalAudioValue;

        // bandPassFilter.type = "bandpass";
        // bandPassFilter.frequency = freq*h*2.5;
        // bandPassFilter.Q = 1/2**(1/2);

        // osc.type = "sine";
        osc_freq = freq*h;
        // velocityGain.gain.value = 0;

        if(h==1) {
            velocityAmount = velValue;
            decay_time = osc_decay - (note-20)/8.0;
            vel_adj = 1+((64 - note)*-0.75/64);
        }
        else {
            velocityAmount = velValue*harmonicRatio[ratioIndex+h-1];
            osc_freq += osc_freq*inHarmonic;
            decay_time = osc_decay - (note-14+(h-1)*6)/12.0;
            vel_adj = 1+((58-note-(h-1)*6)*-0.75/64);
        }

        // velocityAmount *= vel_adj;

        // decay_time = osc_decay;
        // velocityAmount = velValue;



        // osc.connect(oscGain);
        // oscGain.connect(velocityGain);
        // velocityGain.connect(bandPassFilter);
        // bandPassFilter.connect(filter);

        // osc.gain = oscGain;
        // osc.vel = velocityGain;

        harmonicSet.push(oscCreate(osc_freq, velocityAmount, decay_time, filter, freq));
        harmonicSet.push(oscCreate(osc_freq*(2**(0.25/1200)), velocityAmount, decay_time, filter, freq));
        harmonicSet.push(oscCreate(osc_freq*(2**(-0.25/1200)), velocityAmount, decay_time, filter, freq));

        // inHarmonic = Math.random()/200;
        // harmonicSet.push(oscCreate(osc_freq*(1 + inHarmonic/5), velocityAmount*0.8, decay_time*0.8, filter));
        // harmonicSet.push(oscCreate(osc_freq*(1 - inHarmonic/5), velocityAmount*0.8, decay_time*0.8, filter));

        // osc.start();

        // velocityGain.gain.exponentialRampToValueAtTime(velocityAmount, currentTime + osc_attack + osc_easing);
        // velocityGain.gain.exponentialRampToValueAtTime(0.000001, currentTime + osc_attack + decay_time + osc_easing);


    }

    return harmonicSet;
}

function oscCreate(freq, velocityAmount, decay_time, filter, ff, width=10){
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    const velocityGain = ctx.createGain();
    const oscFilter = ctx.createBiquadFilter();
    const delay = ctx.createDelay(1/freq);
    const feedback = ctx.createGain();

    let {currentTime} = ctx;

    feedback.gain.value = 0.95;
    oscGain.gain.value = velocityAmount;

    oscFilter.type = "lowpass";
    oscFilter.frequency = 20000;
    oscFilter.Q = 5;

    osc.type = "sine";
    osc.frequency.value = freq;
    velocityGain.gain.value = 0;

    osc.connect(velocityGain);
    velocityGain.connect(oscGain);
    oscGain.connect(filter);
    oscGain.connect(delay);
    delay.connect(feedback);
    feedback.connect(oscFilter);
    oscFilter.connect(filter);
    oscFilter.connect(delay);

    osc.gain = oscGain;
    osc.vel = velocityGain;
    osc.delay = delay;

    // osc.start();

    velocityGain.gain.exponentialRampToValueAtTime(1, currentTime + osc_attack + osc_easing);
    velocityGain.gain.exponentialRampToValueAtTime(0.000001, currentTime + osc_attack + decay_time + osc_easing);
    // feedback.gain.setValueAtTime(0.15, currentTime);
    feedback.gain.linearRampToValueAtTime(0, currentTime + width/1000);

    return osc;
}
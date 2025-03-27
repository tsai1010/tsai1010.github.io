window.AudioContext = window.AudioContext || window.webkitAudioContext;

let ctx;
let ctxStart = false;

let inputs;
const midiInputs = {};

const startAudio = document.querySelector('body');
const oscSet = {};

startAudio.addEventListener('click', ()=>{
    if(ctxStart==false){
        ctx = new AudioContext;
        ctxStart = true;
        console.log(ctx);
    }

})

function miditoFreq(midiNumber){
    return A4_freq * (2 ** ((midiNumber - 69) / 12.0));
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







function handleInput(input){
    const command = input.data[0] >> 4;
    const channel = input.data[0] & 0xf;
    const note = input.data[1];
    const velocity = input.data[2];

    

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

function noteOn(note, velocity){
    if(!oscSet[note.toString()]){

        const velocityAmount = (1 / 127) * velocity;
        const harmonicType = parseInt((note - 16) / 12);
        // console.log("type:",(note - 16) / 12);
        const filter = ctx.createBiquadFilter();
        const bandPassFilter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency = 24000;
        filter.Q = 1/3**(1/2);

        bandPassFilter.type = "highpass";
        bandPassFilter.frequency = 300;
        bandPassFilter.Q = 1/2**(1/2);

        filter.connect(bandPassFilter);
        bandPassFilter.connect(ctx.destination);

        let inHarmonic = Math.random()/200;
        oscSet[note.toString()] = harmonicCreate(note, miditoFreq(note), velocityAmount, harmonicType, inHarmonic, filter);
        
    }
    
}

function noteOff(note){
    if(oscSet[note.toString()]){

        for(let h = 0; h < harmonic; h++) {
            const osc = oscSet[note.toString()][h];

            const oscGain = osc.gain;
            const velocityGain = osc.vel;
            let {currentTime} = ctx;

            velocityGain.gain.exponentialRampToValueAtTime(0.000001, currentTime + osc_release + osc_easing);

            setTimeout(()=>{
                osc.stop();
                osc.disconnect();
            }, 20)
        }
    
        delete oscSet[note.toString()];
    }
}

function failure(){
    console.log("failure");
}


function harmonicCreate(note, freq, velValue, type, inHarmonic, filter){
    const harmonicSet = [];
    let ratioIndex = type*8;
    for(let h = 1; h < harmonic + 1; h++) {
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        const velocityGain = ctx.createGain();
        const bandPassFilter = ctx.createBiquadFilter();

        let {currentTime} = ctx;

        oscGain.gain.value = totalAudioValue;

        bandPassFilter.type = "bandpass";
        bandPassFilter.frequency = freq*h*2.5;
        bandPassFilter.Q = 1/2**(1/2);

        osc.type = "sine";
        osc.frequency.value = freq*h;
        velocityGain.gain.value = 0;

        if(h==1) {
            velocityAmount = velValue;
            decay_time = osc_decay - (note-20)/8.0;
            vel_adj = 1+((64 - note)*-0.75/64);
        }
        else {
            velocityAmount = velValue*harmonicRatio[ratioIndex+h-1];
            osc.frequency.value += osc.frequency.value*inHarmonic;
            decay_time = osc_decay - (note-14+(h-1)*6)/12.0;
            vel_adj = 1+((58-note-(h-1)*6)*-0.75/64);
        }

        velocityAmount *= vel_adj;

        osc.connect(oscGain);
        oscGain.connect(velocityGain);
        velocityGain.connect(bandPassFilter);
        bandPassFilter.connect(filter);

        osc.gain = oscGain;
        osc.vel = velocityGain;

        harmonicSet.push(osc);

        osc.start();

        velocityGain.gain.exponentialRampToValueAtTime(velocityAmount, currentTime + osc_attack + osc_easing);
        velocityGain.gain.exponentialRampToValueAtTime(0.000001, currentTime + osc_attack + decay_time + osc_easing);


    }

    return harmonicSet;
}
import { IRs } from './IRbase64.js';
import { AsmFunctionsWrapper } from './guitarstring_asm.js';


function MidiSynthCore(target){
    Object.assign(target,{
        properties:{
            debug:      {type:Number, value:0},
            masterVol:  {type:Number, value:0.3, observer:"setMasterVol"},
            voices:     {type:Number, value:64},
            internalcontext: {type:Number, value:0},
            a4_freq: {type:Number, value:440.0, observer:"setA4freq"},
            harmonic: {type:Number, value:9},
            osc_easing: {type:Number, value:0.0001},
            osc_attack: {type:Number, value:0.02},
            osc_decay: {type:Number, value:14.5},
            osc_release: {type:Number, value:2.0},
        },
        harmonicRatio:[
            1.0246079839113384, 1.1582997098203605, 1.1388447671472606, 1.1719544344534898, 1.2164137280584002, 1.0685639213044205, 0.9537010802260389, 0.9815681183973349,
            1.143244941182331, 1.1561880403503995, 1.1476663400547313, 1.1488029936757953, 1.086872695255089, 1.0984287975472282, 0.966653131230532, 1.0410188843390245,
            1.0037683465770395, 1.007146205285253, 0.9409009523639191, 0.9947457664048427, 0.9617784723323823, 0.9045326670684404, 0.8582613131924376, 0.8960555096076478,
            0.972055638107516, 0.9406779746094587, 0.9123789973452026, 0.7965213763826684, 0.8156965567579568, 0.8139021629575786, 0.7697647600840131, 0.7556845067402741,
            0.882455242070097, 0.8458030984856008, 0.8131982403201687, 0.7372657252860997, 0.7216073464462383, 0.6651998103877568, 0.6578420005135593, 0.6575283835590198,
            0.8977268467056416, 0.7558446396734972, 0.7342616083010517, 0.7010909092023433, 0.6643503248668519, 0.6370964804339656, 0.6227372142121878, 0.5929093698600671,
            0.8889964200480135, 0.7591102317460732, 0.6326798492952872, 0.656574107019366, 0.6901026344225969, 0.6834339185789894, 0.6229595254229808, 0.5995726627791448,
            0.7771693877901827, 0.6678207346454161, 0.44054758723425014, 0.5715067781055962,0,0,0,0
        ],
        generateSeedNoise:(seed, samples)=>{
            let noiseArray = new Float32Array(samples);
            for (let i = 0; i < samples; i++) {
                noiseArray[i] = -1 + 2*Math.random();
            }
            return noiseArray;
        },
        generateSeedPinkNoise: (seed, samples) => {
            let noiseArray = new Float32Array(samples);

            // 初始化濾波器參數
            let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

            for (let i = 0; i < samples; i++) {
                const white = -1 + 2 * Math.random(); // 白噪音 [-1, 1]
                b0 = 0.99886 * b0 + white * 0.0555179;
                b1 = 0.99332 * b1 + white * 0.0750759;
                b2 = 0.96900 * b2 + white * 0.1538520;
                b3 = 0.86650 * b3 + white * 0.3104856;
                b4 = 0.55000 * b4 + white * 0.5329522;
                b5 = -0.7616 * b5 - white * 0.0168980;
                const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
                b6 = white * 0.115926;
                noiseArray[i] = pink * 0.11; // 總合縮放避免破音
            }

            return noiseArray;
        },
        generateSeedGrayNoise: (seed, samples, sampleRate = 44100) => {
            const noiseArray = new Float32Array(samples);
            const outputArray = new Float32Array(samples);

            // 白噪音輸入（與原來一樣）
            for (let i = 0; i < samples; i++) {
                noiseArray[i] = -1 + 2 * Math.random();
            }

            // A-weighting 濾波器參數（IIR）
            // 根據 IEC 61672 標準簡化版，以下為雙二階濾波器
            let y1 = 0, y2 = 0, y3 = 0;
            let x1 = 0, x2 = 0;

            const f1 = 20.598997;
            const f2 = 107.65265;
            const f3 = 737.86223;
            const f4 = 12194.217;

            const pi = Math.PI;
            const A1000 = 1.9997; // normalize at 1 kHz

            // 預先計算係數（設計 IIR 濾波器的話可以更精準）
            const k = 2 * pi / sampleRate;
            const a = f4 ** 2 * (noiseArray[0] + 2 * x1 + x2) - (f1 + f2 + f3) * y1 - f1 * f2 * f3 * y2;

            // 簡化：用一個 FIR 類似的平衡濾波，模擬高通+低通效果
            for (let i = 0; i < samples; i++) {
                const x0 = noiseArray[i];

                // A-weighted 模擬（這裡用的是簡化版本，實際用數位濾波器會更準）
                const y = 0.169 * x0 - 0.5 * x1 + 0.33 * x2;

                outputArray[i] = y * A1000;

                // 位移歷史值
                x2 = x1;
                x1 = x0;
            }

            return outputArray;
        },
        generateSeedBrownNoise: (seed, samples) => {
            const noiseArray = new Float32Array(samples);

            let lastOut = 0.0;

            for (let i = 0; i < samples; i++) {
                const white = Math.random() * 2 - 1;
                // 一階積分濾波器，抑制高頻、保留低頻
                noiseArray[i] = (lastOut + (0.02 * white)) / 1.02;
                lastOut = noiseArray[i];

                // 避免累積偏移，稍微 scale
                noiseArray[i] *= 3.5;
            }

            return noiseArray;
        },
        createReverb: async () => {
            // this.convolver = this.actx.createConvolver();

            try {
                const response = await fetch("data:audio/wav;base64," + IRs.IR_Gibson);
                const arraybuffer = await response.arrayBuffer();
                this.audioBuffer = await this.actx.decodeAudioData(arraybuffer);
                // this.convolver.buffer = audioBuffer;
            }catch (error) {
                console.error("Error loading reverb impulse:", error);
            }

            // return convolver;
        },
        makeLimiterCurve:() => {
            const samples = 44100;
            const curve = new Float32Array(samples);
            for (let i = 0; i < samples; ++i) {
                const x = (i * 2) / samples - 1;
                curve[i] = Math.tanh(x * 1.2); // soft limit at roughly ±0.8
            }
            return curve;
        },
        makeAcousticGuitarShaper: (gain = 1.5) => {
            const samples = 44100;
            const curve = new Float32Array(samples);
            for (let i = 0; i < samples; ++i) {
                const x = (i * 2) / samples - 1;
                // 柔和非線性曲線，保留低幅細節
                const y = Math.sign(x) * Math.pow(Math.abs(x), 0.6); // soft non-linearity
                curve[i] = y * 0.55 + x * 0.45; // 60% 非線性 + 40% 原始信號
            }
            return curve;
        },
        // makeAcousticGuitarShaper: (mode = 1) => {
        //     const samples = 44100;
        //     let curve = new Float32Array(samples);
        //     for (let i = 0; i < samples; ++i) {
        //         const x = (i * 2) / samples - 1;
        //         if (mode === 1) {
        //             curve[i] = x * 0.9 + 0.1 * Math.tanh(x * 1.2);
        //         } else if (mode === 2) {
        //             curve[i] = x / (1 + 3 * Math.abs(x));
        //         } else {
        //             curve[i] = x < 0 ? Math.sin(x * 1.5) : Math.tanh(x * 2.2);
        //         }
        //     }
        //     return curve;
        // },
        playBassDrum: (velocity = 100, t, f1 = 100, f2 = 60, duration = 0.4, transientDur = 0.015, fd = 0.15, bpf = 1000) => {
            const now = this._tsConv(t);
            const vNorm = Math.max(0.05, Math.min(velocity, 127)) * this.inv127;

            // 新建 Oscillator 和 GainNode
            const osc = this.actx.createOscillator();
            const gainOsc = this.actx.createGain();

            // 取消之前頻率排程，避免遺留影響
            osc.frequency.cancelScheduledValues(now);
            osc.frequency.setValueAtTime(f1, now); // 100
            osc.frequency.exponentialRampToValueAtTime(f2, now + fd); // 60  0.15

            gainOsc.gain.setValueAtTime(0.0001, now);
            gainOsc.gain.exponentialRampToValueAtTime(vNorm, now + 0.005);
            gainOsc.gain.exponentialRampToValueAtTime(0.001, now + duration); // 0.4

            const highShelf = this.actx.createBiquadFilter();
            highShelf.type = 'highshelf';
            highShelf.frequency.setValueAtTime(2500, now);
            highShelf.gain.setValueAtTime(2.5, now);

            osc.connect(gainOsc).connect(highShelf);
            highShelf.connect(this.softLimiter[9]);

            // Transient 相關同理
            const noiseBuffer = this.actx.createBuffer(1, this.actx.sampleRate * transientDur, this.actx.sampleRate); // 0.15
            const noiseData = noiseBuffer.getChannelData(0);
            for (let i = 0; i < noiseData.length; i++) {
                noiseData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.actx.sampleRate * 0.0025));
            }
            const noise = this.actx.createBufferSource();
            noise.buffer = noiseBuffer;

            const gainNoise = this.actx.createGain();
            gainNoise.gain.setValueAtTime(vNorm * 0.25, now);
            gainNoise.gain.exponentialRampToValueAtTime(0.001, now + transientDur);

            const bandpass = this.actx.createBiquadFilter();
            bandpass.type = 'bandpass';
            bandpass.frequency.setValueAtTime(bpf, now); // 1200
            bandpass.Q.setValueAtTime(1.5, now);

            noise.connect(gainNoise).connect(bandpass);
            bandpass.connect(this.softLimiter[9]);

            // 播放與清理
            osc.start(now);
            osc.stop(now + duration);
            noise.start(now);
            noise.stop(now + transientDur);

            osc.onended = () => {
                osc.disconnect();
                gainOsc.disconnect();
                highShelf.disconnect();
            };
            noise.onended = () => {
                noise.disconnect();
                gainNoise.disconnect();
                bandpass.disconnect();
            };

        },








        init:()=>{
            this.pg=[]; this.vol=[]; this.ex=[]; this.bend=[]; this.rpnidx=[]; this.brange=[];
            this.sustain=[]; this.notetab=[]; this.rhythm=[]; this.pedal=[];
            this.masterTuningC=0; this.masterTuningF=0; this.tuningC=[]; this.tuningF=[]; this.scaleTuning=[];
            this.maxTick=0, this.playTick=0, this.playing=0; this.releaseRatio=3.5; 
            this.oscSet=[]; this.bfSet=[]; this.asmWrapper=[]; this.options=[]; this.seedNoise=[];

            this.inv127 = 1 / 127;

            for(let i=0;i<16;++i){
                let k=[];
                let j=[];
                this.vol[i]=3*100*100/(127*127);
                this.bend[i]=0; this.brange[i]=0x100;
                this.pg[i]=0;
                this.rhythm[i]=0;
                this.pedal[i]=0;
                this.oscSet[i]=k;
                this.bfSet[i]=j;

                this.asmWrapper[i] = new AsmFunctionsWrapper();
                this.options[i] = {
                    stringTension: 0.0,
                    characterVariation: 0.2,
                    stringDamping: 0.5,
                    stringDampingVariation: 0.1,
                    stringDampingCalculation: "direct",
                    pluckDamping: 0.5,
                    pluckDampingVariation: 0.1,
                    body: "simple",
                    stereoSpread: 0.2
                }
            }
            this.rhythm[9]=1;
            this.preroll=0.2;
            this.relcnt=0;

            setInterval(
                function(){
                     if(++this.relcnt>=3){
                        this.relcnt=0;
                        for(let i=this.notetab.length-1;i>=0;--i){
                            var nt=this.notetab[i];
                            if(this.actx.currentTime>nt.e){
                                this._pruneNote(nt);
                                this.notetab.splice(i,1);
                            }
                        }
                    }
                }.bind(this),60
            );

            if(this.debug)
                console.log("internalcontext:"+this.internalcontext)
            // if(this.internalcontext){
            //     window.AudioContext = window.AudioContext || window.webkitAudioContext;
            //     this.setAudioContext(new AudioContext());
            // }
            this.isReady=1;

            console.log("Midi_Synth v0.1.4 Ready");
        },
        setMasterVol:(v)=>{
            if(v!=undefined)
                this.masterVol=v;
            if(this.out)
                this.out.gain.value=this.masterVol;
        },
        setVoices:(v)=>{
            this.voices=v;
        },
        setA4freq:(f)=>{
            this.a4_freq=f;
        },
        reset:()=>{
            for(let i=0;i<16;++i){
                // this.setProgram(i,0);
                this.setBendRange(i,0x100);
                this.setModulation(i,0);
                this.setChVol(i,100);
                this.setPan(i,64);
                this.resetAllControllers(i);
                this.allSoundOff(i);
                this.rhythm[i]=0;
            }
        },
        _pruneNote:(nt)=>{
            for(let k=nt.o.length-1;k>=0;--k){
                if(nt.o[k].frequency){
                    nt.o[k].frequency.cancelScheduledValues(0);
                }
                else{
                    nt.o[k].playbackRate.cancelScheduledValues(0);
                }
                nt.g[k].gain.cancelScheduledValues(0);

                nt.o[k].stop();
                if(nt.o[k].detune) {
                    try {
                        this.chmod[nt.ch].disconnect(nt.o[k].detune);
                    } catch (e) {}
                }
                nt.g[k].gain.value = 0;
            }
        },        
        _limitVoices:(ch,n)=>{
            this.notetab.sort(function(n1,n2){
                if(n1.f!=n2.f) return n1.f-n2.f;
                if(n1.e!=n2.e) return n2.e-n1.e;
                return n2.t-n1.t;
            });
            for(let i=this.notetab.length-1;i>=0;--i){
                var nt=this.notetab[i];
                if(this.actx.currentTime>nt.e || i>=(this.voices-1)){
                    this._pruneNote(nt);
                    this.notetab.splice(i,1);
                }
            }
        },
        _note:(t,ch,n,v)=>{
            let out,sc,pn;
            const o=[],g=[],vp=[],fp=[],r=[];
            const f=this.a4_freq * (2 ** ((n - 69) / 12.0));
            out = this.chvol[ch];

            if(this.debug)
                console.log("note:", ch, n, v);

            if(!this.oscSet[ch][n]){
                let inHarmonic = Math.random()/200;
                let osc_freq;
                const harmonicType = parseInt((n - 16) / 12);
                let ratioIndex = harmonicType*8;
                const velValue = (1 / 127) * v;
                

                const b1 = this.actx.createBiquadFilter();
                b1.type = "bandpass";
                b1.frequency = 24000;
                b1.Q = 1/3**(1/2);

                const h1 = this.actx.createBiquadFilter();
                h1.type = "highpass";
                h1.frequency = 300;
                h1.Q = 1/2;

                b1.connect(h1).connect(out);

                t = this._tsConv(t);
                let i=0;
                for(let h = 1; h < this.harmonic + 1; h++){
                     osc_freq = f*h;

                    if(h==1) {
                            velocityAmount = velValue;
                            decay_time = this.osc_decay - (n-20)/8.0;
                            vel_adj = 1+((64 - n)*-0.75/64);
                        }
                    else {
                        velocityAmount = velValue*this.harmonicRatio[ratioIndex+h-1];
                        osc_freq += osc_freq*inHarmonic;
                        decay_time = this.osc_decay - (n-14+(h-1)*6)/12.0;
                        vel_adj = 1+((58-n-(h-1)*6)*-0.75/64);
                    }

                    velocityAmount *= vel_adj;

                    

                    o[i]=this.oscCreate(t, ch, osc_freq, velocityAmount, decay_time, b1);
                    o[i+1]=this.oscCreate(t, ch, osc_freq*(2**(0.25/1200)), velocityAmount, decay_time, b1);
                    o[i+2]=this.oscCreate(t, ch, osc_freq*(2**(-0.25/1200)), velocityAmount, decay_time, b1);
                    i+=3;
                }
                this.oscSet[ch][n] = o;
            }
        },
        oscCreate:(t,ch,f,v,decay_time,dest)=>{
            const osc = this.actx.createOscillator();
            // const oscGain = ctx.createGain();
            const velocityGain = this.actx.createGain();
            const bandPassFilter = this.actx.createBiquadFilter();
            const delay = this.actx.createDelay(1/f);
            const feedback = this.actx.createGain();

            t = this._tsConv(t);

            // oscGain.gain.value = totalAudioValue;
            feedback.gain.value = 0.5;

            bandPassFilter.type = "lowpass";
            bandPassFilter.frequency = f;
            bandPassFilter.Q = 1/2**(1/2);

            osc.type = "sine";
            osc.frequency.value = f;
            velocityGain.gain.value = 0;

            if(osc.detune){
                this.chmod[ch].connect(osc.detune);
                osc.detune.value = this.bend[ch];
            }

            osc.connect(velocityGain);
            // oscGain.connect(velocityGain);
            velocityGain.connect(dest);
            velocityGain.connect(delay);
            delay.connect(feedback);
            feedback.connect(bandPassFilter);
            bandPassFilter.connect(dest);
            bandPassFilter.connect(delay);

            // osc.gain = oscGain;
            osc.vel = velocityGain;
            osc.delay = delay;

            osc.start();

            velocityGain.gain.exponentialRampToValueAtTime(v, t + this.osc_attack + this.osc_easing);
            velocityGain.gain.exponentialRampToValueAtTime(0.000001, t + this.osc_attack + decay_time + this.osc_easing);
            feedback.gain.setValueAtTime(0.5, t);
            feedback.gain.linearRampToValueAtTime(0, t + 0.02);

            return osc;
        },
         _setParamTarget:(p,v,t,d)=>{
            if(d!=0)
                p.setTargetAtTime(v,t,d);
            else
                p.setValueAtTime(v,t);
        },
        _releaseNote:(nt,t)=>{
            if(nt.ch!=9){
                for(let k=nt.g.length-1;k>=0;--k){
                    nt.g[k].gain.cancelScheduledValues(t);
                    if(t==nt.t2)
                        nt.g[k].gain.setValueAtTime(nt.v[k],t);
                    else if(t<nt.t2)
                        nt.g[k].gain.setValueAtTime(nt.v[k]*(t-nt.t)/(nt.t2-nt.t),t);
                    this._setParamTarget(nt.g[k].gain,0,t,nt.r[k]);
                }
            }
            nt.e=t+nt.r[0]*this.releaseRatio;
            nt.f=1;
        },
        setModulation:(channel,v,t)=>{
            this.chmod[channel].gain.setValueAtTime(v*100/127,this._tsConv(t));
        },
        setChVol:(channel,v,t)=>{
            this.vol[channel]=3*v*v/(127*127);
            this.chvol[channel].gain.setValueAtTime(this.vol[channel]*this.ex[channel],this._tsConv(t));
        },
        setPan:(ch,v,t)=>{
            if(this.chpan[ch])
                this.chpan[ch].pan.setValueAtTime((v-64)/64,this._tsConv(t));
        },
        setExpression:(ch,v,t)=>{
            this.ex[ch]=v*v/(127*127);
            this.chvol[ch].gain.setValueAtTime(this.vol[ch]*this.ex[ch],this._tsConv(t));
        },
        setPedal:(ch,v)=>{
            this.pedal[ch]=v;
        },
        allSoundOff:(ch)=>{
            // for(let i=this.notetab.length-1;i>=0;--i){
            //     const nt=this.notetab[i];
            //     if(nt.ch==ch){
            //         this._pruneNote(nt);
            //         this.notetab.splice(i,1);
            //     }
            // }
            if(this.oscSet[ch]){
                const co = this.oscSet[ch];
                // if(this.debug)
                //     console.log("co:", co);

                co.forEach(o1 => {
                    o1.forEach(o2 => {
                        if(o2.frequency) {
                            o2.frequency.cancelScheduledValues(0);
                            o2.stop();
                            o2.disconnect();
                            if(this.debug)
                                console.log(o2);
                        }
                    })
                });
            }

        },
        resetAllControllers:(ch)=>{
            this.bend[ch]=0; this.ex[ch]=1.0;
            this.rpnidx[ch]=0x3fff; this.sustain[ch]=0; this.pg[ch]=0;
            if(this.chvol[ch]){
                this.chvol[ch].gain.value=this.vol[ch]*this.ex[ch];
                this.chmod[ch].gain.value=0;
            }
        },
        setBendRange:(ch,v)=>{
            this.brange[ch]=v;
        },
        _tsConv:(t)=>{
            if(t==undefined||t<=0){
                t=0;
                if(this.actx)
                    t=this.actx.currentTime;
            }
            return t;
        },
        setBend:(ch,v,t)=>{
            t=this._tsConv(t);
            const br=this.brange[ch]*100/127;
            this.bend[ch]=(v-8192)*br/8192;
            
            const bfBend = this.bfSet[ch];

            this.oscSet[ch]?.flat().forEach(osc => {
                osc?.detune?.setValueAtTime(this.bend[ch], t);
                if (this.debug) console.log(osc);
            });
            // if(this.oscSet[ch]){
            //     const co = this.oscSet[ch];
            //     // if(this.debug)
            //     //     console.log("co:", co);

            //     co.forEach(o1 => {
            //         o1.forEach(o2 => {
            //             if(o2.detune) {
            //                 o2.detune.setValueAtTime(this.bend[ch],t);
            //                 if(this.debug)
            //                     console.log(o2);
            //             }
            //         })
            //     });
            // }
            bfBend.forEach(node => {
                if (node instanceof AudioBufferSourceNode) {
                    node.detune.setValueAtTime(this.bend[ch],t);
                }
            });

        },
        setPG:(ch, v)=>{
            this.pg[ch]=v;
        },
        setChannelAfterTouch:(channel,v,t)=>{
            this.vol[channel]=3*v*v/(127*127);
            this.chvol[channel].gain.exponentialRampToValueAtTime(this.vol[channel]*this.ex[channel],this._tsConv(t));
        },
        noteOff:(ch, n, t)=>{
            t=this._tsConv(t);
            // for(let i=this.notetab.length-1;i>=0;--i){
            //     const nt=this.notetab[i];
            //     if(t>=nt.t && nt.ch==ch && nt.n==n && nt.f==0){
            //         nt.f=1;
            //         if(this.sustain[ch]<64)
            //             this._releaseNote(nt,t);
            //     }
            // }
            
            // console.log("pedal:", this.pedal[ch]);
            if(this.pedal[ch] < 64){
                const bfs = this.bfSet[ch][n];
                if(bfs instanceof AudioBufferSourceNode) {
                    switch(this.pg[ch]){
                        case 24: case 25: bfs.stop(t+0.02); break;
                        default: bfs.stop(t+0.4); break;
                    }
                    return;
                }
            }
            

            if(this.oscSet[ch][n]){

                if(this.debug)
                        console.log("osc[0]:", this.oscSet[ch][n][0]);
                for(let h = 0; h < this.harmonic*3; h++) {
                    const osc = this.oscSet[ch][n][h];
                    
                    // const oscGain = osc.gain;
                    const velocityGain = osc.vel;

                    osc.delay.disconnect();
                    t= this._tsConv(t);

                    velocityGain.gain.exponentialRampToValueAtTime(0.000001, t + this.osc_release + this.osc_easing);

                    setTimeout(()=>{
                        osc.stop();
                        osc.disconnect();
                    }, 20)
                }
            
                delete this.oscSet[ch][n];
            }
        },
        noteOn:(ch, note, vel, t)=>{
            if(this.debug)
                console.log("noteOn:", ch, note, vel, t);
            if(vel==0){
                this.noteOff(ch,note,t);
                return;
            }

            t=this._tsConv(t);

            if(ch==9){
                switch(note){
                    // playBassDrum(vel, t, f1, f2, dur, t_dur, df_dur, bpf)
                    case 35:
                        this.playBassDrum(vel, t, 80, 60); break;
                    case 36:
                        this.playBassDrum(vel, t, 100, 80); break;
                    case 38:
                        this.playBassDrum(vel, t, 220, 180); break;
                    case 40:
                        this.playBassDrum(vel, t, 250, 200); break;
                    case 41:
                        this.playBassDrum(vel, t, 110, 70, 0.75, 0.06, 0.45, 1400); break;
                    case 43:
                        this.playBassDrum(vel, t, 140, 110); break;
                    case 45:
                        this.playBassDrum(vel, t, 180, 140); break;
                    case 48:
                        this.playBassDrum(vel, t, 200, 150, 0.75, 0.06, 0.3, 280); break;
                    case 37:
                        this.playBassDrum(vel, t, 800, 750, 0.15, 0.03); break;
                    case 63:
                        this.playBassDrum(vel, t, 300, 200, 0.15, 0.03); break;
                }

                return;
            }

            
            if(this.pg[ch]==-1)
                this._note(t,ch,note,vel);
            else {
                // this.actx.resume();
                const bfs1 = this.bfSet[ch][note];
                if (bfs1 instanceof AudioBufferSourceNode) {
                    // switch(this.pg[ch]){
                    //     case 24:case 25: bfs1.stop(t+0.02); break;
                    //     default: bfs1.stop(t+0.02); break;
                    // }

                    bfs1.stop(t+0.02);
                }
                let f=this.a4_freq * (2 ** ((note - 69) / 12.0));
                // f = f.toFixed(5);
                let sampleRate = this.actx.sampleRate;
                let bf = this.actx.createBuffer(2, this.actx.sampleRate, this.actx.sampleRate);
                let nn = Math.pow(note/64, 0.5);
                if(!nn) nn = 0;
                this.options[ch].stringDamping = (note * this.inv127)*0.85 + 0.15;

                let smoothingFactor = this.options[ch].stringDamping +
                                        nn * (1 - this.options[ch].stringDamping) * 0.5 +
                                        (1 - this.options[ch].stringDamping) *
                                        Math.random() * this.options[ch].stringDampingVariation;
                this.seedNoise[ch] = this.generateSeedPinkNoise(65535, Math.round(sampleRate/f));
                 // 0.5 + (note / 127 - 0.5) * 0.9
                // this.options[ch].stringTension = 1 + ((note * this.inv127) * -0.9);
                // this.options.stringTension = 0.9 * (1 - Math.pow((note * this.inv127), 1.5));
                this.asmWrapper[ch].pluck(
                    bf,
                    this.seedNoise[ch],
                    sampleRate,
                    f,
                    smoothingFactor,
                    vel/4.0,
                    this.options[ch],
                    0.2
                );
                const bfs = this.actx.createBufferSource();
                bfs.buffer = bf;
                bfs.connect(this.chvol[ch]);
                
                this.chmod[ch].connect(bfs.detune);
                bfs.detune.value = this.bend[ch];
                this.bfSet[ch][note]=bfs;
                bfs.addEventListener('ended', () => {
                    if (this.bfSet[ch][note] === bfs) {
                        this.bfSet[ch][note] = null;
                        if (this.debug) console.log(`bfs[channel:${ch}][note:${note}] cleared`);
                    }
                });

                bfs.start(t);
            }
        },
        send:(msg, t)=>{
            const channel=msg[0]&0xf;
            const command=msg[0]&~0xf;
            if(this.debug)
                console.log(msg[1], msg[2]);
            if(command<0x80||command>=0x100)
                return;
            if(this.audioContext.state=="suspended"){
                this.audioContext.resume();
            }
            switch(command){
                case 0xb0:
                    switch(msg[1]){
                        case 1:  this.setModulation(channel,msg[2],t); break;
                        case 7:  this.setChVol(channel,msg[2],t); break;
                        case 10: this.setPan(channel,msg[2],t); break;
                        case 11: this.setExpression(channel,msg[2],t); break;
                        case 64: this.setPedal(channel,msg[2]); break;
                        case 120:  /* all sound off */
                        case 123:  /* all notes off */
                        case 124: case 125: case 126: case 127: /* omni off/on mono/poly */
                            this.allSoundOff(channel);
                            break;
                        case 121: this.resetAllControllers(channel); break;
                    }
                    break;
                case 0xc0: this.setPG(channel,msg[1]); break;
                case 0xd0: this.setChannelAfterTouch(channel,msg[1],t); break;
                case 0xe0: this.setBend(channel,(msg[1]+(msg[2]<<7)),t); break;
                case 0x90: this.noteOn(channel,msg[1],msg[2],t); break;
                case 0x80: this.noteOff(channel,msg[1],t); break;
                case 0xf0:
                    if (msg[0] == 0xff)
                        this.reset();
                    break;
            }
        },
        getAudioContext:()=>{
            return this.actx;
        },
        setAudioContext:(actx, dest)=>{
            this.audioContext=this.actx=actx;
            this.dest=dest;
            
            // this.bufferSource=this.actx.createBufferSource();
            // this.bf = this.actx.createBuffer(2, this.actx.sampleRate, this.actx.sampleRate);
            if(!dest)
                this.dest=actx.destination;
            this.out=this.actx.createGain();
            this.revg=this.actx.createGain();
            this.outg=this.actx.createGain();
            this.comp=this.actx.createDynamicsCompressor();
            

            this.comp.threshold.setValueAtTime(-18, this.actx.currentTime);
            this.comp.knee.setValueAtTime(10, this.actx.currentTime);
            this.comp.ratio.setValueAtTime(3, this.actx.currentTime);
            this.comp.attack.setValueAtTime(0.003, this.actx.currentTime);
            this.comp.release.setValueAtTime(0.2, this.actx.currentTime);
            

            this.setMasterVol();

            this.revg.gain.setValueAtTime(0.09, this.actx.currentTime); // 0.09
            this.outg.gain.setValueAtTime(0.15, this.actx.currentTime); // 0.15
            (async () => {
                await this.createReverb(); // ✅ 確保等到 ConvolverNode 回來
                if (!this.audioBuffer) {
                    console.error("Reverb node is null");
                    return;
                }

                
                // this.out.connect(this.convolver);
                // this.convolver.connect(this.revg);
            })();

            // this.out.connect(this.revb);
            // this.revb.connect(this.comp);
            this.out.connect(this.comp);
            this.outg.connect(this.out);
            this.revg.connect(this.out);
            this.comp.connect(this.dest);
            this.chvol=[]; this.chmod=[]; this.chpan=[]; this.conv=[]; this.shap=[]; this.revDelay=[];
            this.oldGain=[]; this.preGain=[]; this.postShaperGain=[]; this.dryLowGain=[]; this.shapGain=[]; this.dry=[]; this.wet=[];
            this.postFilter=[]; this.warmthBoost=[]; this.lpf=[]; this.hpf=[]; this.shapLpf=[]; this.highBoost=[]; this.softLimiter=[];
            this.lfo=this.actx.createOscillator();
            this.lfo.frequency.value=5;
            this.lfo.start(0);
            for(let i=0;i<16;++i){
                this.chvol[i]=this.actx.createGain();
                this.conv[i]=this.actx.createConvolver();
                this.conv[i].buffer=this.audioBuffer;

                this.revDelay[i]=this.actx.createDelay();
                this.revDelay[i].delayTime.setValueAtTime(0.01, this.actx.currentTime);

                this.wet[i]=this.actx.createGain();
                this.dry[i]=this.actx.createGain();
                this.wet[i].connect(this.out);
                this.dry[i].connect(this.out);

                this.wet[i].gain.setValueAtTime(0.12, this.actx.currentTime); // 0.09
                this.dry[i].gain.setValueAtTime(0.2, this.actx.currentTime); // 0.15

                this.shap[i]=this.actx.createWaveShaper();
                this.shap[i].curve = this.makeAcousticGuitarShaper();
                this.shap[i].oversample = '4x';
                this.preGain[i] = this.actx.createGain();
                this.preGain[i].gain.setValueAtTime(0.1, this.actx.currentTime);

                this.postShaperGain[i] = this.actx.createGain();
                this.postShaperGain[i].gain.setValueAtTime(0.6, this.actx.currentTime);


                this.postFilter[i] = this.actx.createBiquadFilter();
                this.postFilter[i].type = 'lowpass';
                this.postFilter[i].frequency.value = 6000;
                this.postFilter[i].Q.value = 0.5;


                this.warmthBoost[i] = this.actx.createBiquadFilter();
                this.warmthBoost[i].type = "peaking";
                this.warmthBoost[i].frequency.value = 250; // 低中頻
                this.warmthBoost[i].Q.value = 1.0;
                this.warmthBoost[i].gain.value = 2.5; // 提升 4 dB 左右

                this.hpf[i] = this.actx.createBiquadFilter();
                this.hpf[i].type = 'highpass';
                this.hpf[i].frequency.value = 120;
                this.hpf[i].Q.value = 0.707;

                this.lpf[i] = this.actx.createBiquadFilter();
                this.lpf[i].type = 'lowpass';
                this.lpf[i].frequency.value = 100;
                this.lpf[i].Q.value = 0.707;

                this.shapLpf[i] = this.actx.createBiquadFilter();
                this.shapLpf[i].type = 'lowpass';
                this.shapLpf[i].frequency.value = 6000;
                this.shapLpf[i].Q.value = 0.6;

                this.highBoost[i] = this.actx.createBiquadFilter();
                this.highBoost[i].type = 'highshelf';
                this.highBoost[i].frequency.value = 3000;
                this.highBoost[i].gain.value = 1.5; // 提升 3dB

                this.dryLowGain[i] = this.actx.createGain();
                this.dryLowGain[i].gain.setValueAtTime(0.3, this.actx.currentTime);

                this.shapGain[i] = this.actx.createGain();
                this.shapGain[i].gain.setValueAtTime(0.2, this.actx.currentTime);

                this.oldGain[i] = this.actx.createGain();
                this.oldGain[i].gain.setValueAtTime(0.5, this.actx.currentTime);

                this.softLimiter[i] = this.actx.createWaveShaper();
                this.softLimiter[i].curve = this.makeLimiterCurve();
                this.softLimiter[i].oversample = '4x';

                if(this.actx.createStereoPanner){
                    this.chpan[i]=this.actx.createStereoPanner();
                    this.chvol[i].connect(this.chpan[i]);
                    this.chpan[i].connect(this.preGain[i]);

                    this.chpan[i].connect(this.oldGain[i]).connect(this.postShaperGain[i]);
                    
                    // this.chpan[i].connect(this.shap[i]).connect(this.conv[i]).connect(this.revg);
                }
                else{
                    this.chpan[i]=null;
                    this.chvol[i].connect(this.preGain[i]);

                    this.chvol[i].connect(this.oldGain[i]).connect(this.postShaperGain[i]);
                    // this.chvol[i].connect(this.shap[i]).connect(this.conv[i]).connect(this.revg);
                }

                this.preGain[i].connect(this.hpf[i]).connect(this.shap[i]).connect(this.postFilter[i]).connect(this.warmthBoost[i]).connect(this.highBoost[i]).connect(this.shapGain[i]).connect(this.softLimiter[i]).connect(this.shapLpf[i]).connect(this.postShaperGain[i]);
                this.preGain[i].connect(this.lpf[i]).connect(this.dryLowGain[i]).connect(this.postShaperGain[i]);

                this.postShaperGain[i].connect(this.dry[i]);
                this.postShaperGain[i].connect(this.revDelay[i]).connect(this.conv[i]).connect(this.wet[i]);

                this.chmod[i]=this.actx.createGain();
                this.lfo.connect(this.chmod[i]);
                // this.pg[i]=0;
                this.resetAllControllers(i);
            }

            this.wet[9].gain.setValueAtTime(0.9, this.actx.currentTime); 
            this.dry[9].gain.setValueAtTime(0.1, this.actx.currentTime); 

            this.softLimiter[9].disconnect();
            this.softLimiter[9].connect(this.postShaperGain[9]);

            const duration = 1;
            const sampleRate = this.actx.sampleRate;
            const length = sampleRate * duration;
            const irBuffer = this.actx.createBuffer(2, length, sampleRate);

            for (let ch = 0; ch < 2; ch++) {
                const channelData = irBuffer.getChannelData(ch);
                for (let i = 0; i < length; i++) {
                    const t = i / sampleRate;
                    const decay = Math.exp(-t * 6);
                    const hfAttenuation = 1 - Math.pow(t / duration, 3);
                    channelData[i] = (Math.random() * 2 - 1) * decay * hfAttenuation * 0.4;
                }
            }

            // 建立 OfflineAudioContext 用來濾波 IR
            const offlineCtx = new OfflineAudioContext(2, length, sampleRate);

            const bufferSource = offlineCtx.createBufferSource();
            bufferSource.buffer = irBuffer;

            const lowpass = offlineCtx.createBiquadFilter();
            lowpass.type = 'lowpass';
            lowpass.frequency.value = 1200; // 調整頻率控制保留多少高頻

            bufferSource.connect(lowpass);
            lowpass.connect(offlineCtx.destination);

            bufferSource.start();

            offlineCtx.startRendering().then(filteredBuffer => {
                // for(let i=0;i<16;++i){
                //     this.conv[i].buffer = filteredBuffer;
                // }
                this.conv[9].buffer = filteredBuffer;
            });
            this.postShaperGain[9].gain.setValueAtTime(1.0, this.actx.currentTime);

            // 🔊 測試音 (440Hz, 1 秒)
            try {
                const testOsc = this.actx.createOscillator();
                const testGain = this.actx.createGain();
                testOsc.type = "sine";
                testOsc.frequency.value = 440;
                testGain.gain.value = 0.2; // 適中音量
                testOsc.connect(testGain).connect(this.dest);
                testOsc.start();
                testOsc.stop(this.actx.currentTime + 1);
                console.log("[MidiSynth] 測試音播放中 (440Hz for 1s)");
            } catch (e) {
                console.warn("[MidiSynth] 測試音失敗", e);
            }

            // 🔇 保活：靜音 ConstantSource，不改動音色路徑
            try {
                this._keepGain = this.actx.createGain();
                this._keepGain.gain.value = 0;
                this._keeposc = this.actx.createOscillator();
                this._keeposc.connect(this._keepGain).connect(this.dest);
                this._keeposc.start();
                console.log("[MidiSynth] 靜音 ConstantSource");
            } catch (e) { /* 老舊瀏覽器沒有 ConstantSource 就略過 */ }

            

        }
    });
}

class MidiSynth {
  constructor(opt){
        MidiSynthCore.bind(this)(this);
        for(let k in this.properties){
            this[k]=this.properties[k].value;
        }
        this.init();
    }
}

export default MidiSynth;

window.MidiSynth = MidiSynth;
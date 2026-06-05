import MidiSynth from 'https://tsai1010.github.io/scripts/midisynth-gui.js';

(function(){
'use strict';

// ═══════════════════════════════════════════════════════════════════
// CANVAS SETUP
// ═══════════════════════════════════════════════════════════════════
var canvas=document.getElementById('c');
var cx=canvas.getContext('2d');
var W=0,H=0,dpr=1;
var mx=0.5,my=0.5; // normalized mouse [0..1]
var mouseActive=false;

function resize(){
  dpr=window.devicePixelRatio||1;
  W=window.innerWidth;H=window.innerHeight;
  canvas.width=W*dpr;canvas.height=H*dpr;
  cx.setTransform(dpr,0,0,dpr,0,0);
}
resize();
window.addEventListener('resize',resize);

// ═══════════════════════════════════════════════════════════════════
// AUDIO ENGINE — MidiSynth + Routing Composer
// ═══════════════════════════════════════════════════════════════════
var ctx=null, anl=null, anl2=null;
var midi_synth=null;
var started=false;
var ctxStart=false;

// hold-to-arp state
var isHolding=false;
var arpTimer=null;
var arpStep=0;
var activeNotes=[];
var lastTriggerTime=0;
var currentNote=60;
var currentVelocity=90;
var currentSmoothOffset=0;

// MIDI arp pattern. You can change this to [0,3,7,10] for minor/darker sound.
var arpPattern=[0,4,7,12,7,4];

async function initAudio(){
  if(!ctxStart){
    ctx=new(window.AudioContext||window.webkitAudioContext)();

    // analysers for original visualizer. Synth output is routed into this chain.
    anl=ctx.createAnalyser();
    anl.fftSize=2048;
    anl.smoothingTimeConstant=0.8;
    anl2=ctx.createAnalyser();
    anl2.fftSize=512;
    anl2.smoothingTimeConstant=0.85;

    var visualInput=ctx.createGain();
    visualInput.gain.value=0.85;
    visualInput.connect(anl);
    anl.connect(anl2);
    anl2.connect(ctx.destination);

    midi_synth=new MidiSynth();
    midi_synth.setAudioContext(ctx, anl);
    window.MidiSynth=MidiSynth;
    window.synth=midi_synth;
    window.midi_synth=midi_synth;

    if(typeof midi_synth.enableRoutingComposer==='function'){
      await midi_synth.enableRoutingComposer({
        button:'#composer-slot',
        tailwind:'auto'
      });
      installSmoothPatchWhenReady();
    }

    ctxStart=true;
    started=true;
    console.log('[Demo3] MidiSynth started:', ctx);
  } else if(ctx && ctx.state==='suspended'){
    await ctx.resume();
  }
}

function installSmoothPatchWhenReady(){
  var tries=0;
  var id=setInterval(function(){
    tries++;
    var engine=window.__RC_HANDLE__&&window.__RC_HANDLE__.engine;
    if(!engine){
      if(tries>80)clearInterval(id);
      return;
    }
    if(engine.__demo3SmoothPatched){
      clearInterval(id);
      return;
    }

    var original=engine.resolveKSSmoothing&&engine.resolveKSSmoothing.bind(engine);
    if(typeof original!=='function'){
      clearInterval(id);
      return;
    }

    engine.resolveKSSmoothing=function(params,note,velocity){
      var out=original(params,note,velocity);
      var extra=Number(window.demo3SmoothOffset||0);
      if(Number.isFinite(extra)){
        var next=this.clampValue(out.finalSmooth+extra,0.01,0.99);
        out.finalSmooth=next;
      }
      return out;
    };

    engine.__demo3SmoothPatched=true;
    clearInterval(id);
    console.log('[Demo3] X-axis smoothing patch installed');
  },100);
}

function clamp(v,min,max){return Math.min(max,Math.max(min,v));}

function yToNote(y){
  // top = higher pitch, bottom = lower pitch
  return Math.round(48+(1-y)*36); // C3 ~ C6
}

function xToSmoothOffset(x){
  // left = brighter / steel-like, right = smoother / nylon-like
  return -0.18+x*0.36;
}

function xToVelocity(x){
  return Math.round(70+x*40); // 70~110
}

function xToInterval(x){
  // fastest near center to keep the original “collision” idea
  var center=1-Math.abs(x-0.5)*2; // 0 at sides, 1 at center
  return Math.round(170-center*80); // 170ms sides, 90ms center
}

function noteName(n){
  var notes=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  return notes[((n%12)+12)%12]+(Math.floor(n/12)-1);
}

function updateAudio(){
  if(!started)return;

  currentNote=yToNote(my);
  currentVelocity=xToVelocity(mx);
  currentSmoothOffset=xToSmoothOffset(mx);
  window.demo3SmoothOffset=currentSmoothOffset;

  var smoothText=currentSmoothOffset>=0?'+'+currentSmoothOffset.toFixed(3):currentSmoothOffset.toFixed(3);
  var pitchHz=440*Math.pow(2,(currentNote-69)/12);

  document.getElementById('fl-hz').textContent='MIDI '+currentNote;
  document.getElementById('fl-note').textContent=noteName(currentNote);
  document.getElementById('fr-hz').textContent=smoothText;
  document.getElementById('fr-note').textContent=mx<0.5?'brighter':'smoother';
  document.getElementById('beat-display').textContent=isHolding?'PLAYING':'HOLD';

  document.getElementById('label-left').style.opacity=0.15+(1-mx)*0.5;
  document.getElementById('label-right').style.opacity=0.15+mx*0.5;
}

function noteOn(note,vel,ch){
  if(!midi_synth)return;
  ch=(ch==null)?0:ch;
  midi_synth.send([0x90|ch,note,vel]);
  activeNotes.push({note:note,ch:ch});
}

function noteOff(note,ch){
  if(!midi_synth)return;
  ch=(ch==null)?0:ch;
  midi_synth.send([0x80|ch,note,0]);
}

function releaseAllNotes(){
  if(!activeNotes.length)return;
  activeNotes.forEach(function(n){noteOff(n.note,n.ch);});
  activeNotes=[];
}

function triggerArp(){
  if(!isHolding||!midi_synth)return;
  updateAudio();

  var base=currentNote;
  var note=clamp(base+arpPattern[arpStep%arpPattern.length],21,108);
  var vel=currentVelocity;
  var ch=0;
  var dur=130;

  noteOn(note,vel,ch);
  setTimeout(function(){noteOff(note,ch);},dur);

  arpStep++;
  lastTriggerTime=performance.now();
  clearTimeout(arpTimer);
  arpTimer=setTimeout(triggerArp,xToInterval(mx));
}

async function startArp(){
  await initAudio();
  if(ctx&&ctx.state==='suspended')await ctx.resume();
  isHolding=true;
  arpStep=0;
  clearTimeout(arpTimer);
  triggerArp();
}

function stopArp(){
  isHolding=false;
  clearTimeout(arpTimer);
  arpTimer=null;
  releaseAllNotes();
  updateAudio();
}

function freqToNote(f){
  var n=Math.round(12*Math.log2(f/440)+69);
  return noteName(n);
}

// ═══════════════════════════════════════════════════════════════════
// PARTICLES — Two opposing streams
// ═══════════════════════════════════════════════════════════════════
var particlesL=[],particlesR=[],collisionParticles=[];
var MAX_P=200;

function Particle(side){
  this.side=side; // 'left' or 'right'
  this.reset();
}
Particle.prototype.reset=function(){
  if(this.side==='left'){
    this.x=-10;
    this.y=Math.random()*H;
    this.vx=0.5+Math.random()*2;
    this.vy=(Math.random()-0.5)*0.5;
    this.r=1.5+Math.random()*2.5;
    this.hue=10+Math.random()*30; // warm orange-red
    this.life=1;
  } else {
    this.x=W+10;
    this.y=Math.random()*H;
    this.vx=-(0.5+Math.random()*2);
    this.vy=(Math.random()-0.5)*0.5;
    this.r=1+Math.random()*2;
    this.hue=200+Math.random()*40; // cold blue
    this.life=1;
  }
  this.alpha=0.3+Math.random()*0.5;
  this.decay=0.0008+Math.random()*0.0005;
};
Particle.prototype.update=function(power,audioLevel){
  var speed=1+audioLevel*3;
  this.x+=this.vx*speed;
  this.y+=this.vy;
  this.life-=this.decay;

  // Attract toward mouse Y
  var dy=(my*H-this.y)*0.002;
  this.vy+=dy;
  this.vy*=0.98;

  // Scale by power
  var s=power*0.7+0.3;
  this.alpha=s*(0.3+audioLevel*0.5)*this.life;

  // Collision zone — particles near center slow down and spark
  var centerX=mx*W;
  var distToCenter=Math.abs(this.x-centerX);
  if(distToCenter<80){
    this.vx*=0.97;
    if(Math.random()<0.03*audioLevel){
      spawnCollisionSpark(this.x,this.y,this.hue);
    }
  }

  if(this.life<=0||this.x<-20||this.x>W+20)this.reset();
};
Particle.prototype.draw=function(){
  if(this.alpha<0.01)return;
  cx.beginPath();
  cx.arc(this.x,this.y,this.r,0,Math.PI*2);
  cx.fillStyle='hsla('+this.hue+',80%,60%,'+this.alpha+')';
  cx.fill();

  // Glow trail
  if(this.alpha>0.15){
    cx.beginPath();
    cx.arc(this.x,this.y,this.r*3,0,Math.PI*2);
    cx.fillStyle='hsla('+this.hue+',60%,50%,'+this.alpha*0.1+')';
    cx.fill();
  }
};

function spawnCollisionSpark(x,y,srcHue){
  if(collisionParticles.length>100)return;
  collisionParticles.push({
    x:x,y:y,
    vx:(Math.random()-0.5)*4,
    vy:(Math.random()-0.5)*4,
    r:1+Math.random()*2,
    hue:(srcHue+180)%360, // opposite color
    life:1,
    decay:0.02+Math.random()*0.02
  });
}

// Init particles
for(var i=0;i<MAX_P;i++){
  particlesL.push(new Particle('left'));
  particlesR.push(new Particle('right'));
  // Stagger initial positions
  particlesL[i].x=Math.random()*W*0.5;
  particlesR[i].x=W*0.5+Math.random()*W*0.5;
}

// ═══════════════════════════════════════════════════════════════════
// WAVE RINGS — concentric circles from each side
// ═══════════════════════════════════════════════════════════════════
var ringsL=[],ringsR=[];
var ringTimer=0;

function spawnRing(side){
  var arr=side==='left'?ringsL:ringsR;
  if(arr.length>8)return;
  arr.push({
    x:side==='left'?0:W,
    y:my*H,
    radius:10,
    maxRadius:W*0.7,
    speed:side==='left'?2:2,
    hue:side==='left'?15:220,
    alpha:0.3,
    life:1
  });
}

// ═══════════════════════════════════════════════════════════════════
// FREQUENCY BARS — opposite direction spectrum
// ═══════════════════════════════════════════════════════════════════
var freqData=null,timeData=null;

// ═══════════════════════════════════════════════════════════════════
// RENDER LOOP
// ═══════════════════════════════════════════════════════════════════
var lastTime=0;

function render(now){
  requestAnimationFrame(render);
  var dt=Math.min((now-lastTime)/16.67,3);
  lastTime=now;

  // Audio data
  var audioLevel=0,audioLevelR=0;
  if(anl2&&started){
    if(!freqData)freqData=new Uint8Array(anl2.frequencyBinCount);
    if(!timeData)timeData=new Uint8Array(anl.fftSize);
    anl2.getByteFrequencyData(freqData);
    anl.getByteTimeDomainData(timeData);
    // Average level
    var sum=0;
    for(var i=0;i<freqData.length;i++)sum+=freqData[i];
    audioLevel=sum/(freqData.length*255);
  }

  var leftPower=1-mx;
  var rightPower=mx;

  // ── Clear with subtle fade (trails) ──
  cx.fillStyle='rgba(0,0,0,'+(0.08+audioLevel*0.05)+')';
  cx.fillRect(0,0,W,H);

  // ── Background gradient — shifts with mouse ──
  var grd=cx.createLinearGradient(0,0,W,0);
  grd.addColorStop(0,'rgba(40,8,8,'+(0.3*leftPower)+')');
  grd.addColorStop(0.5,'rgba(5,5,15,0.1)');
  grd.addColorStop(1,'rgba(8,15,40,'+(0.3*rightPower)+')');
  cx.fillStyle=grd;
  cx.fillRect(0,0,W,H);

  // ── Wave rings ──
  ringTimer+=dt;
  if(ringTimer>30){ringTimer=0;spawnRing('left');spawnRing('right');}

  function drawRings(arr,dir){
    for(var i=arr.length-1;i>=0;i--){
      var r=arr[i];
      r.radius+=r.speed*dt*(1+audioLevel*2);
      r.life-=0.008*dt;
      r.alpha=r.life*0.2;
      if(r.life<=0||r.radius>r.maxRadius){arr.splice(i,1);continue;}
      cx.beginPath();
      cx.arc(r.x,r.y,r.radius,0,Math.PI*2);
      cx.strokeStyle='hsla('+r.hue+',50%,40%,'+r.alpha+')';
      cx.lineWidth=1.5;
      cx.stroke();
    }
  }
  drawRings(ringsL,'left');
  drawRings(ringsR,'right');

  // ── Center waveform — where forces collide ──
  if(timeData&&started){
    var centerX=mx*W;
    var waveW=W*0.4;
    cx.beginPath();
    cx.strokeStyle='rgba(255,255,255,'+(0.1+audioLevel*0.3)+')';
    cx.lineWidth=1.5;
    var step=Math.floor(timeData.length/200);
    for(var i=0;i<200;i++){
      var v=(timeData[i*step]/128-1);
      var px=centerX-waveW/2+i*(waveW/200);
      var py=H/2+v*100*(1+audioLevel*2);
      if(i===0)cx.moveTo(px,py);else cx.lineTo(px,py);
    }
    cx.stroke();
  }

  // ── Frequency spectrum — split left/right opposite directions ──
  if(freqData&&started){
    var barCount=64;
    var centerX=mx*W;
    var barMaxH=H*0.3;

    for(var i=0;i<barCount;i++){
      var val=freqData[i*2]/255;
      var barH=val*barMaxH;
      if(barH<1)continue;
      var spacing=4;
      // Left bars go leftward from center
      var bx=centerX-(i+1)*spacing;
      if(bx>0){
        cx.fillStyle='hsla(15,70%,50%,'+(val*0.4*leftPower)+')';
        cx.fillRect(bx,H/2-barH/2,spacing-1,barH);
      }
      // Right bars go rightward from center
      bx=centerX+i*spacing;
      if(bx<W){
        cx.fillStyle='hsla(220,70%,50%,'+(val*0.4*rightPower)+')';
        cx.fillRect(bx,H/2-barH/2,spacing-1,barH);
      }
    }
  }

  // ── Collision zone glow ──
  var collIntensity=1-Math.abs(mx-0.5)*2;
  if(collIntensity>0.1&&started){
    var centerX=mx*W;
    var glow=cx.createRadialGradient(centerX,my*H,0,centerX,my*H,100+audioLevel*100);
    glow.addColorStop(0,'rgba(255,255,255,'+(collIntensity*audioLevel*0.15)+')');
    glow.addColorStop(0.5,'rgba(200,180,255,'+(collIntensity*audioLevel*0.05)+')');
    glow.addColorStop(1,'rgba(0,0,0,0)');
    cx.fillStyle=glow;
    cx.fillRect(centerX-200,my*H-200,400,400);
  }

  // ── Particles ──
  for(var i=0;i<particlesL.length;i++){
    particlesL[i].update(leftPower,audioLevel);
    particlesL[i].draw();
  }
  for(var i=0;i<particlesR.length;i++){
    particlesR[i].update(rightPower,audioLevel);
    particlesR[i].draw();
  }

  // ── Collision sparks ──
  for(var i=collisionParticles.length-1;i>=0;i--){
    var sp=collisionParticles[i];
    sp.x+=sp.vx*dt;sp.y+=sp.vy*dt;
    sp.life-=sp.decay*dt;
    if(sp.life<=0){collisionParticles.splice(i,1);continue;}
    cx.beginPath();
    cx.arc(sp.x,sp.y,sp.r*sp.life,0,Math.PI*2);
    cx.fillStyle='hsla('+sp.hue+',90%,70%,'+sp.life*0.8+')';
    cx.fill();
  }

  // ── Cursor ring pulse with audio ──
  var curRing=document.querySelector('.cur-ring');
  var curCore=document.querySelector('.cur-core');
  if(curRing&&started){
    var s=20+audioLevel*15;
    curRing.style.width=s+'px';
    curRing.style.height=s+'px';
    var coreColor='hsl('+(15+mx*205)+',70%,60%)';
    curCore.style.background=coreColor;
    curCore.style.boxShadow='0 0 '+(8+audioLevel*12)+'px '+coreColor;
    curRing.style.borderColor='hsla('+(15+mx*205)+',50%,60%,'+(0.3+audioLevel*0.3)+')';
  }
}


// ═══════════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════════
var cursorEl=document.getElementById('cursor');

function setPointer(x,y){
  mx=clamp(x/W,0,1);
  my=clamp(y/H,0,1);
  cursorEl.style.left=x+'px';
  cursorEl.style.top=y+'px';
  mouseActive=true;
  updateAudio();
}

document.addEventListener('mousemove',function(e){
  setPointer(e.clientX,e.clientY);
});

document.addEventListener('mousedown',function(e){

  // Intro 還在時不允許演奏
  if(intro && intro.style.display !== 'none') return;

  // 不要影響 Routing Composer
  if(e.target.closest &&
     e.target.closest('#composer-slot, .rc-panel, .rc-toggle-btn, button, input, select, textarea, a'))
    return;

  if(e.button!==0)return;

  setPointer(e.clientX,e.clientY);
  startArp();
});

document.addEventListener('mouseup',function(){
  stopArp();
});

document.addEventListener('mouseleave',function(){
  stopArp();
});

document.addEventListener('touchmove',function(e){
  e.preventDefault();
  var t=e.touches[0];
  if(t)setPointer(t.clientX,t.clientY);
},{passive:false});

document.addEventListener('touchstart',function(e){

  // Intro 還在時不允許演奏
  if(intro && intro.style.display !== 'none') return;

  if(e.target.closest &&
     e.target.closest('#composer-slot, .rc-panel, .rc-toggle-btn, button, input, select, textarea, a'))
    return;

  e.preventDefault();

  var t=e.touches[0];
  if(t)setPointer(t.clientX,t.clientY);

  startArp();

},{passive:false});

document.addEventListener('touchend',function(){
  stopArp();
});

// Intro click
var intro=document.getElementById('intro');
async function startExperience(){

  intro.style.opacity='0';

  setTimeout(function(){
    intro.style.display='none';
  },1000);

  await initAudio();

  // 保證第一次點擊不會開始演奏
  stopArp();

  updateAudio();

  setTimeout(function(){
    document.getElementById('title').style.opacity='0.15';
  },5000);
}
intro.addEventListener('click',startExperience);
intro.addEventListener('touchstart',function(e){e.preventDefault();startExperience();},{passive:false});

// ═══════════════════════════════════════════════════════════════════
// START RENDER
// ═══════════════════════════════════════════════════════════════════
requestAnimationFrame(render);

})();

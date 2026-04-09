function drawPiano(){
    drawWhitekey();
    drawBlackkey();

    const audioV = document.querySelector("#audioValue");
    audioV.addEventListener("input", (event) => {
      totalAudioValue = event.target.value;
      setMasterV(totalAudioValue);
    })

    const tuneV = document.querySelector("#tuneValue");
    tuneV.addEventListener("input", (event) => {
        A4_freq = event.target.value;
        setA4(A4_freq);
        document.getElementById("tuneFreq").innerText = A4_freq + "Hz";
    })
    
}
function drawWhitekey(){
    let keyboard = document.querySelector("#KeyboardW");
    let m = 19;

    for(let a = 0; a < 52; a++){
      let b = a - 2;
      if (b == -1) m += 2;
      else if (b % 7 == 0) m += 1;
      else if (b % 7 == 3) m += 1;
      else m += 2;

      keyboard.innerHTML +=
        "<div id=\"whiteKey\" " +
        "onmousedown=\"keyOn(this, " + m + ", (window.midiCcPanelGetVelocity ? window.midiCcPanelGetVelocity() : 70), (window.midiCcPanelGetChannel ? window.midiCcPanelGetChannel() : 15), 'ui');\" " +
        "onmouseup=\"keyOff(this, " + m + ", 'ui');\" " +
        "class=\"" + midiToId[m] + "\"></div>";
    }
}
function drawBlackkey(){
    let keyboard = document.querySelector("#KeyboardB");
    let b = -1;
    let m = 20;

    for(let a = 1; a < 52; a++){
      let black = true;
      let a2 = a - 2;

      if (a2 == 0) black = false;
      else if (a2 % 7 == 0) black = false;
      else if (a2 % 7 == 3) black = false;

      if (black){
        if (b == -1) m += 2;
        else if (b % 5 == 0) m += 3;
        else if (b % 5 == 2) m += 3;
        else m += 2;

        keyboard.innerHTML +=
          "<div id=\"blackKey\" " +
          "onmousedown=\"keyOn(this, " + m + ", (window.midiCcPanelGetVelocity ? window.midiCcPanelGetVelocity() : 70), (window.midiCcPanelGetChannel ? window.midiCcPanelGetChannel() : 15), 'ui');\" " +
          "onmouseup=\"keyOff(this, " + m + ", 'ui');\" " +
          "class=\"" + midiToId[m] + "\"></div>";

        b += 1;
      }
      else {
        keyboard.innerHTML += "<div id=\"noKey\"></div>";
      }
    }
}
  


function menuShow(){
    const menu = document.querySelector("#menu");
    const img = document.querySelector("#img");
    if(menuBtn_click==false){
      menuBtn_click = true;
      menu.style.display="block";
      img.src="images/image2.png";
    }
    else if(menuBtn_click==true){
      menuBtn_click = false;
      menu.style.display="none";
      img.src="images/image1.png";
    }
}

function menuBarOver(bar){
    bar.style.background = menuBarColor;
}

function menuBarOut(bar){
    bar.style.background = "none";
}

function AudioBtn(){
    const img = document.querySelector("#AudioImg");
    if(playInput){
      img.src="images/AudioOff.png";
      playInput = false;
    }
    else{
      img.src="images/AudioOn.png";
      playInput = true;
    }
}

function midiPortSet(portName){
    console.log("value:", portName.value);
    setPort(portName.value);
}

function keyOn(key, note, velocity, channelcolor, src = 'ui'){
    if(key.id=="whiteKey") {
      key.style.background=WkeyColor[channelcolor];

      KeyGradientFX.on(key, {
        gradient: WkeyColor[channelcolor],
        velocity,
        introFromMinLight: true,
        introDuration: 160,
        introTail: { light: 0.8, mid: 1.0, dark: 1.2 },
        floatAmp: 2.5,
        floatHz: 2.5,
        keepBounce: true
      });

    }
    else if(key.id=="blackKey") {
      key.style.background=BkeyColor[channelcolor];

      KeyGradientFX.on(key, {
        gradient: BkeyColor[channelcolor],
        velocity,
        introFromMinLight: true,
        introDuration: 240,
        introTail: { light: 0.8, mid: 1.0, dark: 1.2 },
        floatAmp: 2.5,
        floatHz: 2.5,
        keepBounce: true
      });
    }

    const ch0 = Math.max(0, Math.min(15, Number(channelcolor) || 0));

    // 讓 keyOff 用得到
    if (key) key.dataset.midiChannel = String(ch0);

    if (src === 'ext') {
      if (playInput) synthOn(note, velocity, ch0);
    } else {
      synthOn(note, velocity, ch0);
    }
}
function keyOff(key, note, src = 'ui') {
  if (!key) return;

  KeyGradientFX.off(key);

  if (key.id == "whiteKey") key.style.background = "white";
  else if (key.id == "blackKey") key.style.background = "black";

  const ch0 = Math.max(
    0,
    Math.min(15, Number(key.dataset.midiChannel ?? 0) || 0)
  );

  if (src === 'ext') {
    if (playInput) synthOff(note, ch0);
  } else {
    synthOff(note, ch0);
  }
}

const downKeys = window.__downKeys || (window.__downKeys = new Map());

function isFromUi(e) {
  const t = e.target;
  if (!t) return false;

  if (
    t.tagName === 'INPUT' ||
    t.tagName === 'SELECT' ||
    t.tagName === 'TEXTAREA' ||
    t.isContentEditable
  ) return true;

  return typeof t.closest === 'function' && t.closest('.mcp-panel');
}

function isPlayableKey(e) {
  const code = e.keyCode || e.which;
  return (code >= 48 && code <= 90) || code === 188;
}

function releaseAllDownKeys() {
  for (const [, hit] of downKeys) {
    keyOff(hit.el, hit.midi, 'ui');
  }
  downKeys.clear();
}

function handleKeyboardDown(e) {
  if (!isPlayableKey(e) || isFromUi(e)) return;
  if (e.repeat) return;

  const code = e.keyCode || e.which;
  const el = document.getElementsByClassName(keyToId[code])[0];
  const midi = parseInt(keyToMidi[code], 10);
  const vel = window.midiCcPanelGetVelocity ? window.midiCcPanelGetVelocity() : 70;
  const ch0 = window.midiCcPanelGetChannel ? window.midiCcPanelGetChannel() : 14;

  if (!el || !Number.isFinite(midi)) return;

  keyOn(el, midi, vel, ch0, 'ui');
  downKeys.set(code, { el, midi, channel: ch0 });
}

function handleKeyboardUp(e) {
  const code = e.keyCode || e.which;
  const hit = downKeys.get(code);
  if (!hit) return;

  if (hit.el) {
    hit.el.dataset.midiChannel = String(hit.channel ?? 0);
    keyOff(hit.el, hit.midi, 'ui');
  }

  downKeys.delete(code);
}

window.removeEventListener('keydown', handleKeyboardDown);
window.removeEventListener('keyup', handleKeyboardUp);

window.addEventListener('keydown', handleKeyboardDown, { passive: false });
window.addEventListener('keyup', handleKeyboardUp, { passive: false });

window.addEventListener('blur', releaseAllDownKeys);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) releaseAllDownKeys();
});

drawPiano();

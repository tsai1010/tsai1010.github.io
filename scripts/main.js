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
    //let whiteKeyHtml = "<div id=\"whiteKey\" onmousedown=\"keyOn(this);\" onmouseup=\"keyOff(this);\" ";
    let m = 19;
    for(let a=0;a<52;a++){
      /*----------------------KeyboardMidi---------------------*/
      let b = a-2;
      if(b==-1) m += 2;
      else if(b%7==0) m += 1;
      else if(b%7==3) m += 1;
      else m += 2;
      /*--------------------------------------------------------*/
      keyboard.innerHTML += "<div id=\"whiteKey\" onmousedown=\"keyOn(this, " + m + ", 70, 15);\" onmouseup=\"keyOff(this, " + m + ");\" class=" + midiToId[m] +"></div>";
    }
}
function drawBlackkey(){
    let keyboard = document.querySelector("#KeyboardB");
    let b = -1;m = 20;
    for(let a=1;a<52;a++){
      let black = true;
      let a2 = a - 2;
      if(a2==0) black = false;
      else if(a2%7==0) black = false;
      else if(a2%7==3) black = false;
      if(black){
        if(b==-1) m += 2;
        else if(b%5==0) m += 3;
        else if(b%5==2) m += 3;
        else m += 2;
        keyboard.innerHTML += "<div id=\"blackKey\" onmousedown=\"keyOn(this, " + m + ", 70, 15);\" onmouseup=\"keyOff(this, " + m + ");\" class=" + midiToId[m] +"></div>";
        b += 1;
      }
      else keyboard.innerHTML += "<div id=\"noKey\"></div>";
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

function keyOn(key, note, velocity, channelcolor){
    //console.log(note, velocity);
    if(key.id=="whiteKey") {
      key.style.background=WkeyColor[channelcolor];

      KeyGradientFX.on(key, {
        gradient: WkeyColor[channelcolor],
        velocity,
        introFromMinLight: true,            // 先「幾乎沒淺色」→ 回到原本比例
        introDuration: 160,                 // 進場時長（可調 120–260）
        introTail: { light: 0.8, mid: 1.0, dark: 1.2 }, // 起始尾端三段的窄度（％）
        floatAmp: 2.5,                      // 在原本比例附近小幅搖動
        floatHz: 2.5,
        keepBounce: true
      });

    }
    else if(key.id=="blackKey") {
      key.style.background=BkeyColor[channelcolor];

      KeyGradientFX.on(key, {
        gradient: BkeyColor[channelcolor],
        velocity,
        introFromMinLight: true,            // 先「幾乎沒淺色」→ 回到原本比例
        introDuration: 240,                 // 進場時長（可調 120–260）
        introTail: { light: 0.8, mid: 1.0, dark: 1.2 }, // 起始尾端三段的窄度（％）
        floatAmp: 2.5,                      // 在原本比例附近小幅搖動
        floatHz: 2.5,
        keepBounce: true
      });
    }
    
    if(playInput&&channelcolor>13) synthOn(note, velocity);
    //console.info(key);
}
function keyOff(key, note){

  KeyGradientFX.off(key);
  
  if(key.id=="whiteKey") key.style.background="white";
  else if(key.id=="blackKey") key.style.background="black";
    
    
  if(playInput) synthOff(note);
    
}

document.addEventListener("keydown", (e) => {
if((e.keyCode>=48&&e.keyCode<=90)||e.keyCode==188) {
  if (e.repeat) return;
  keyOn(document.getElementsByClassName(keyToId[e.keyCode])[0], parseInt(keyToMidi[e.keyCode]), 70, 14);
}
});
document.addEventListener("keyup", (e) => {
if((e.keyCode>=48&&e.keyCode<=90)||e.keyCode==188) keyOff(document.getElementsByClassName(keyToId[e.keyCode])[0], parseInt(keyToMidi[e.keyCode]));
});

drawPiano();

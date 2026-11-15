(function(){
  "use strict";
  var $ = function(id){ return document.getElementById(id); };
  var inApp = !!(window.AppInventor && typeof window.AppInventor.setWebViewString === "function");
  var wifiBox = document.querySelector(".wifi");
  var connText = $("connection");
  var toastEl = $("toast");
  var toastTimer = null, hbTimer = null;
  var HEARTBEAT_TIMEOUT = 20000; // ms without heartbeat => ESP32 Offline

  // === PASTE YOUR FIREBASE REALTIME DATABASE URL HERE (the https link shown in Firebase console) ===
  var FIREBASE_URL = "https://smart-villa-8fd1e-default-rtdb.firebaseio.com"; // e.g. https://my-project-default-rtdb.firebaseio.com
  var DB = FIREBASE_URL.replace(/\/+$/, "");
  var cloud = !inApp && /^https:\/\//.test(DB);       // browser mode: talk to Firebase directly
  var lastLocal = 0, lastSeenVal = null;

  /* ---------- helpers ---------- */
  // App Inventor passes everything as strings ("0" is truthy in JS), so normalize.
  function isOn(v){
    return v === true || v === 1 || v === "1" || v === "true" || v === "on" || v === "ON";
  }
  function put(id, v, suffix){
    if(v === undefined || v === null || v === "" || v === "null") return;
    $(id).textContent = v + (suffix || "");
  }
  function toast(msg){
    if(!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toastEl.classList.remove("show"); }, 1600);
  }
  function setConnection(state, text){
    wifiBox.classList.toggle("offline", state === "offline");
    connText.textContent = text;
  }

  /* ---------- command channel: page -> App Inventor -> Firebase -> ESP32 ---------- */
  function send(msg){
    if(inApp){
      window.AppInventor.setWebViewString(msg);
      toast("Command sent");
    }else if(cloud){
      var p = msg.split("|");
      lastLocal = Date.now();
      fetch(DB + "/" + p[0] + "/state.json", {method: "PUT", body: JSON.stringify(p[1])})
        .then(function(r){ if(!r.ok) throw new Error(r.status); toast("Command sent"); })
        .catch(function(){ toast("Send failed - check Firebase URL / rules"); });
    }else{
      console.log("Command:", msg);
      toast("Preview mode - command not sent");
    }
  }
  setConnection("wait", (inApp || cloud) ? "Waiting for ESP32" : "Preview Mode");

  /* ---------- navigation ---------- */
  function showView(id){
    document.querySelectorAll(".view").forEach(function(v){ v.classList.toggle("active", v.id === id); });
    document.querySelectorAll(".nav").forEach(function(n){ n.classList.toggle("active", n.dataset.tab === id); });
    window.scrollTo(0, 0);
  }
  document.querySelectorAll("[data-open]").forEach(function(b){ b.addEventListener("click", function(){ showView(b.dataset.open); }); });
  document.querySelectorAll(".nav").forEach(function(b){ b.addEventListener("click", function(){ showView(b.dataset.tab); }); });

  /* ---------- lights ---------- */
  function updateRoom(room, state){
    var on = isOn(state);
    document.querySelectorAll('input[data-room="' + room + '"]').forEach(function(i){ i.checked = on; });
    var status = $("status-" + room);
    if(status){ status.classList.toggle("on", on); status.lastElementChild.textContent = on ? "ON" : "OFF"; }
    var cs = $("control-status-" + room);
    if(cs){ cs.textContent = on ? "Light is ON" : "Light is OFF"; cs.style.color = on ? "#00e6a4" : "#a7bdd8"; }
  }
  document.querySelectorAll("input[data-room]").forEach(function(input){
    input.addEventListener("change", function(){
      var room = input.dataset.room, on = input.checked;
      updateRoom(room, on);
      send(room + "|" + (on ? "1" : "0"));
    });
  });
  window.setRoomState = updateRoom; // javascript:setRoomState('room1','1')

  /* ---------- door ---------- */
  function selectActive(button, groupSelector){
    document.querySelectorAll(groupSelector).forEach(function(b){ b.classList.remove("active"); });
    button.classList.add("active");
  }
  [["doorOpen", "open", "#doors .actions .btn"], ["doorClose", "close", "#doors .actions .btn"],
   ["controlsDoorOpen", "open", "#controls .actions .btn"], ["controlsDoorClose", "close", "#controls .actions .btn"]
  ].forEach(function(d){
    var b = $(d[0]);
    b.addEventListener("click", function(){ selectActive(b, d[2]); send("door|" + d[1]); });
  });
  window.setDoorStatus = function(s){
    $("doorStatus").textContent = s;
    $("controlsDoorStatus").textContent = s;
  };

  /* ---------- curtains ---------- */
  function setCurtainUi(state, detail){
    $("curtainState").textContent = state;
    $("curtainMotorStatus").textContent = detail;
  }
  [["curtainOpen", "open", "Opening", "Open command sent"],
   ["curtainStop", "stop", "Stopped", "Stop command sent"],
   ["curtainClose", "close", "Closing", "Close command sent"]
  ].forEach(function(c){
    var b = $(c[0]);
    b.addEventListener("click", function(){
      selectActive(b, ".curtain-actions .curtain-btn");
      setCurtainUi(c[2], c[3]);
      send("curtain|" + c[1]);
    });
  });
  window.setCurtainStatus = function(state){
    setCurtainUi(state, "ESP32: " + state);
  };

  /* ---------- solar ---------- */
  function setSolarMode(mode){
    var auto = (mode === "auto");
    $("solarAuto").classList.toggle("selected", auto);
    $("solarManual").classList.toggle("selected", !auto);
  }
  $("solarAuto").addEventListener("click", function(){ setSolarMode("auto"); send("solar|auto"); });
  $("solarManual").addEventListener("click", function(){ setSolarMode("manual"); send("solar|manual"); });
  window.setSolarMode = setSolarMode;                       // javascript:setSolarMode('auto')
  window.setSolarStatus = function(s){ $("solarStatus").textContent = s; };
  window.setSolar = function(angle, lux, power, battery){   // javascript:setSolar('45','800','12','85')
    put("panelAngle", angle, "\u00B0");
    put("sunlight", lux, " lux");
    put("power", power, " W");
    put("battery", battery, "%");
  };

  /* ---------- sensors ---------- */
  window.setSensors = function(temp, humidity, motion, gas){ // javascript:setSensors('27','55','0','0')
    put("temperature", temp, " \u00B0C");
    put("humidity", humidity, " %");
    if(motion !== undefined && motion !== ""){
      $("motion").textContent = isOn(motion) ? "Motion detected" : "No motion";
    }
    if(gas !== undefined && gas !== ""){
      var g = $("gas");
      g.textContent = isOn(gas) ? "ALERT: smoke / gas detected" : "Normal";
      g.style.color = isOn(gas) ? "#ff6b6b" : "";
    }
  };

  /* ---------- ESP32 online/offline ---------- */
  // Call from App Inventor every time the Firebase "lastSeen" value changes.
  window.heartbeat = function(){
    setConnection("online", "ESP32 Online");
    clearTimeout(hbTimer);
    hbTimer = setTimeout(function(){ setConnection("offline", "ESP32 Offline"); }, HEARTBEAT_TIMEOUT);
  };

  /* ---------- browser mode: read state back from Firebase every 2s ---------- */
  function poll(){
    fetch(DB + "/.json").then(function(r){ return r.json(); }).then(function(d){
      if(!d) return;
      if(Date.now() - lastLocal > 3000){
        ["room1","room2","room3","room4"].forEach(function(r){
          if(d[r] && d[r].state !== undefined) updateRoom(r, d[r].state);
        });
      }
      if(d.door && d.door.status) window.setDoorStatus(d.door.status);
      if(d.curtain && d.curtain.status) window.setCurtainStatus(d.curtain.status);
      if(d.solar){
        window.setSolar(d.solar.angle, d.solar.lux, d.solar.power, d.solar.battery);
        if(d.solar.status) window.setSolarStatus(d.solar.status);
        if(d.solar.state) setSolarMode(d.solar.state);
      }
      if(d.sensors) window.setSensors(d.sensors.temp, d.sensors.humidity, d.sensors.motion, d.sensors.gas);
      if(d.esp32 && d.esp32.lastSeen !== undefined && d.esp32.lastSeen !== lastSeenVal){
        lastSeenVal = d.esp32.lastSeen;
        window.heartbeat();
      }
    }).catch(function(){});
  }
  if(cloud){ poll(); setInterval(poll, 2000); }
})();

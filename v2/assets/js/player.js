(function(){
  'use strict';
  var player = null;
  var ready = false;
  var pending = null;
  var queue = [];
  var currentIndex = -1;
  var shuffle = false;
  var repeat = false;
  var listeners = new Set();

  function emit(type, detail){
    listeners.forEach(function(fn){ try{ fn(type, detail); }catch(_e){} });
  }
  function parseTime(value){
    if (!value) return 0;
    if (/^\d+$/.test(String(value))) return Number(value);
    var m = String(value).match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
    return m ? (Number(m[1]||0)*3600 + Number(m[2]||0)*60 + Number(m[3]||0)) : 0;
  }
  function parseYouTubeUrl(raw){
    try{
      var url = new URL(raw);
      var host = url.hostname.replace(/^www\./,'');
      var id = '';
      if (host === 'youtu.be') id = url.pathname.split('/')[1] || '';
      else if (url.pathname === '/watch') id = url.searchParams.get('v') || '';
      else {
        var parts = url.pathname.split('/').filter(Boolean);
        if (['shorts','embed','live'].includes(parts[0])) id = parts[1] || '';
      }
      var start = parseTime(url.searchParams.get('t') || url.searchParams.get('start'));
      return id ? { videoId:id, startSeconds:start } : null;
    }catch(_e){ return null; }
  }
  function ensurePlayer(){
    if (player || !window.YT || !YT.Player) return;
    player = new YT.Player('youtube-player',{
      width:'100%', height:'100%',
      playerVars:{playsinline:1,origin:window.location.origin,rel:0},
      events:{
        onReady:function(){
          ready=true;
          player.setVolume(Number(document.getElementById('volume').value)||80);
          if(pending){ var value=pending; pending=null; load(value.index,value.autoplay); }
          emit('ready',{});
        },
        onStateChange:function(event){
          if(event.data===YT.PlayerState.ENDED){
            if(repeat) load(currentIndex,true);
            else next();
          }
        },
        onError:function(event){ emit('error',{code:event.data}); }
      }
    });
  }
  window.onYouTubeIframeAPIReady = ensurePlayer;

  function setQueue(rows){
    queue = Array.isArray(rows) ? rows.slice() : [];
    if(currentIndex >= queue.length) currentIndex = -1;
  }
  function load(index, autoplay){
    if(!queue.length) return;
    index = ((index % queue.length) + queue.length) % queue.length;
    var parsed = parseYouTubeUrl(queue[index].dUrl);
    if(!parsed){ emit('error',{code:'invalid-url',row:queue[index]}); return; }
    currentIndex=index;
    emit('track',{row:queue[index],index:index});
    if(!ready){ pending={index:index,autoplay:autoplay!==false}; ensurePlayer(); return; }
    var spec={videoId:parsed.videoId,startSeconds:parsed.startSeconds};
    if(autoplay===false) player.cueVideoById(spec);
    else player.loadVideoById(spec);
  }
  function next(){
    if(!queue.length) return;
    var target = shuffle && queue.length > 1
      ? (function(){ var n; do{n=Math.floor(Math.random()*queue.length);}while(n===currentIndex); return n; })()
      : currentIndex + 1;
    load(target,true);
  }
  function previous(){ load(currentIndex <= 0 ? queue.length-1 : currentIndex-1,true); }
  function seek(delta){
    if(!ready || !player || typeof player.getCurrentTime!=='function') return;
    player.seekTo(Math.max(0,player.getCurrentTime()+delta),true);
  }
  function setVolume(value){
    if(ready && player) player.setVolume(Number(value));
  }

  window.V2Player={
    setQueue:setQueue,load:load,next:next,previous:previous,seek:seek,setVolume:setVolume,
    setShuffle:function(value){shuffle=Boolean(value);},
    setRepeat:function(value){repeat=Boolean(value);},
    getCurrentRow:function(){return queue[currentIndex]||null;},
    on:function(fn){listeners.add(fn);return function(){listeners.delete(fn);};},
    parseYouTubeUrl:parseYouTubeUrl
  };
  if(window.YT && window.YT.Player) ensurePlayer();
})();

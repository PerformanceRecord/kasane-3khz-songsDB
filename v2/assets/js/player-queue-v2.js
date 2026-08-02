(function(){
  'use strict';
  var player=null;
  var ready=false;
  var apiLoading=false;
  var pending=null;
  var queue=[];
  var currentIndex=-1;
  var shuffle=false;
  var shuffleOrder=[];
  var shufflePosition=-1;
  var repeatMode='off';
  var listeners=new Set();

  function emit(type,detail){
    listeners.forEach(function(fn){try{fn(type,detail);}catch(_e){}});
  }
  function parseTime(value){
    if(!value)return 0;
    if(/^\d+$/.test(String(value)))return Number(value);
    var match=String(value).match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
    return match?(Number(match[1]||0)*3600+Number(match[2]||0)*60+Number(match[3]||0)):0;
  }
  function parseYouTubeUrl(raw){
    try{
      var url=new URL(raw);
      var host=url.hostname.replace(/^www\./,'');
      var id='';
      if(host==='youtu.be')id=url.pathname.split('/')[1]||'';
      else if(url.pathname==='/watch')id=url.searchParams.get('v')||'';
      else{
        var parts=url.pathname.split('/').filter(Boolean);
        if(['shorts','embed','live'].includes(parts[0]))id=parts[1]||'';
      }
      var start=parseTime(url.searchParams.get('t')||url.searchParams.get('start'));
      return id?{videoId:id,startSeconds:start}:null;
    }catch(_e){return null;}
  }
  function ensurePlayer(){
    if(player||!window.YT||!YT.Player)return;
    player=new YT.Player('youtube-player',{
      width:'100%',
      height:'100%',
      playerVars:{playsinline:1,enablejsapi:1,origin:window.location.origin,rel:0},
      events:{
        onReady:function(){
          ready=true;
          player.setVolume(Number(document.getElementById('volume').value)||80);
          emit('ready',{});
          if(pending){var value=pending;pending=null;load(value.index,value.autoplay,true);}
        },
        onStateChange:function(event){
          emit('state',{state:event.data});
          if(event.data===YT.PlayerState.ENDED)handleEnded();
        },
        onError:function(event){emit('error',{code:event.data});}
      }
    });
  }
  function loadApi(){
    if(window.YT&&window.YT.Player){ensurePlayer();return;}
    if(apiLoading)return;
    apiLoading=true;
    var script=document.createElement('script');
    script.src='https://www.youtube.com/iframe_api';
    script.async=true;
    script.onerror=function(){apiLoading=false;emit('error',{code:'api-load'});};
    document.head.appendChild(script);
  }
  window.onYouTubeIframeAPIReady=function(){apiLoading=false;ensurePlayer();};

  function queueKey(row){
    return String(row&&(row.rowId||row.dUrl||''));
  }
  function makeShuffleOrder(avoidFirst){
    var order=queue.map(function(_row,index){return index;});
    for(var i=order.length-1;i>0;i--){
      var j=Math.floor(Math.random()*(i+1));
      var value=order[i];order[i]=order[j];order[j]=value;
    }
    if(order.length>1&&order[0]===avoidFirst){
      var swapWith=1+Math.floor(Math.random()*(order.length-1));
      var first=order[0];order[0]=order[swapWith];order[swapWith]=first;
    }
    return order;
  }
  function resetShuffleOrder(startIndex){
    if(!shuffle||!queue.length){
      shuffleOrder=[];
      shufflePosition=-1;
      return;
    }
    if(startIndex>=0&&startIndex<queue.length){
      shuffleOrder=[startIndex].concat(makeShuffleOrder(-1).filter(function(index){return index!==startIndex;}));
      shufflePosition=0;
      return;
    }
    shuffleOrder=makeShuffleOrder(currentIndex);
    shufflePosition=-1;
  }
  function setQueue(rows){
    var nextQueue=Array.isArray(rows)?rows.slice():[];
    var sameQueue=nextQueue.length===queue.length&&nextQueue.every(function(row,index){
      return queueKey(row)===queueKey(queue[index]);
    });
    var current=queue[currentIndex];
    queue=nextQueue;
    if(current){
      var key=queueKey(current);
      currentIndex=queue.findIndex(function(row){return queueKey(row)===key;});
    }else if(currentIndex>=queue.length){
      currentIndex=-1;
    }
    if(shuffle&&!sameQueue)resetShuffleOrder(currentIndex);
  }
  function load(index,autoplay,fromShuffle){
    if(!queue.length){emit('error',{code:'empty-queue'});return;}
    index=((index%queue.length)+queue.length)%queue.length;
    var parsed=parseYouTubeUrl(queue[index].dUrl);
    if(!parsed){emit('error',{code:'invalid-url',row:queue[index]});return;}
    if(shuffle&&!fromShuffle)resetShuffleOrder(index);
    currentIndex=index;
    emit('track',{row:queue[index],index:index});
    if(!ready){
      pending={index:index,autoplay:autoplay!==false};
      loadApi();
      ensurePlayer();
      return;
    }
    var spec={videoId:parsed.videoId,startSeconds:parsed.startSeconds};
    if(autoplay===false)player.cueVideoById(spec);
    else player.loadVideoById(spec);
  }
  function next(options){
    if(!queue.length)return;
    var fromEnded=Boolean(options&&options.fromEnded);
    if(shuffle){
      if(!shuffleOrder.length)resetShuffleOrder(currentIndex);
      if(shufflePosition+1<shuffleOrder.length){
        shufflePosition++;
        load(shuffleOrder[shufflePosition],true,true);
        return;
      }
      if(fromEnded&&repeatMode!=='all'){
        emit('queueend',{});
        return;
      }
      resetShuffleOrder(-1);
      if(!shuffleOrder.length)return;
      shufflePosition=0;
      load(shuffleOrder[shufflePosition],true,true);
      return;
    }
    var target=currentIndex<0?0:currentIndex+1;
    if(target>=queue.length){
      if(fromEnded&&repeatMode!=='all'){emit('queueend',{});return;}
      target=0;
    }
    load(target,true);
  }
  function previous(){
    if(!queue.length)return;
    if(shuffle){
      if(shufflePosition<=0)return;
      shufflePosition--;
      load(shuffleOrder[shufflePosition],true,true);
      return;
    }
    load(currentIndex<=0?queue.length-1:currentIndex-1,true);
  }
  function handleEnded(){
    if(repeatMode==='one')load(currentIndex,true,true);
    else next({fromEnded:true});
  }
  function seek(delta){
    if(!ready||!player||typeof player.getCurrentTime!=='function')return;
    player.seekTo(Math.max(0,player.getCurrentTime()+delta),true);
  }
  function setVolume(value){if(ready&&player)player.setVolume(Number(value));}
  function pause(){
    if(currentIndex>=0&&(!ready||!player)){
      pending={index:currentIndex,autoplay:false};
      return;
    }
    if(ready&&player&&typeof player.pauseVideo==='function')player.pauseVideo();
  }
  function togglePlayback(){
    if(!queue.length){emit('error',{code:'empty-queue'});return;}
    if(currentIndex<0){if(shuffle)next();else load(0,true);return;}
    if(!ready||!player){
      pending={index:currentIndex,autoplay:true};
      loadApi();
      ensurePlayer();
      return;
    }
    var playerState=player.getPlayerState();
    if(playerState===YT.PlayerState.PLAYING)player.pauseVideo();
    else player.playVideo();
  }
  function setShuffle(value){
    var active=Boolean(value);
    if(active===shuffle)return;
    shuffle=active;
    resetShuffleOrder(shuffle?currentIndex:-1);
  }
  function setRepeatMode(value){
    repeatMode=['off','one','all'].includes(value)?value:'off';
    emit('repeatmode',{mode:repeatMode});
  }

  window.V2Player={
    setQueue:setQueue,load:load,next:next,previous:previous,seek:seek,setVolume:setVolume,
    pause:pause,togglePlayback:togglePlayback,prepare:loadApi,setShuffle:setShuffle,
    setRepeatMode:setRepeatMode,getCurrentRow:function(){return queue[currentIndex]||null;},
    on:function(fn){listeners.add(fn);return function(){listeners.delete(fn);};},
    parseYouTubeUrl:parseYouTubeUrl
  };
  loadApi();
})();
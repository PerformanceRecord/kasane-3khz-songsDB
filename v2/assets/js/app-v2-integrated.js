(function(){
  'use strict';
  var STATIC_BASE='https://pub-34d8fa96953d472aa7cb424b9daf2d60.r2.dev/public-data/';
  var state={category:'ショート',songs:[],gags:[],visible:[],playerVisible:false,playing:null,repeatMode:'off'};

  function el(id){return document.getElementById(id);}
  function text(value){return String(value==null?'':value);}
  function normalize(value){return text(value).toLowerCase().replace(/\s+/g,' ').trim();}
  function staticUrl(path){return new URL(path,STATIC_BASE).toString();}
  function displayDate(value){
    var s=text(value).replace(/\D/g,'');
    return s.length>=8 ? s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8) : '';
  }
  async function fetchRows(name){
    var response=await fetch(staticUrl(name+'.json'),{cache:'no-store'});
    if(!response.ok) throw new Error(name+' HTTP '+response.status);
    var payload=await response.json();
    if(payload.ok===false || !Array.isArray(payload.rows)) throw new Error(name+' の形式が不正です');
    return payload.rows.filter(function(row){return row && (row.title||row.artist);});
  }
  function setStatus(message){el('status').textContent=message;}

  function filteredRows(){
    var source=state.category==='gags' ? state.gags : state.songs.filter(function(row){
      return text(row.kind).trim()===state.category;
    });
    var query=normalize(el('search').value);
    if(!query) return source.slice();
    return source.filter(function(row){
      return normalize(text(row.artist)+' '+text(row.title)).includes(query);
    });
  }
  function rowKey(row){return text(row.rowId)||[row.artist,row.title,row.kind,row.dUrl].map(text).join('|');}
  function videoIdFromRow(row){
    var parsed=window.V2Player.parseYouTubeUrl(row&&row.dUrl);
    return parsed&&parsed.videoId?parsed.videoId:'';
  }
  function updateRepeatControl(){
    var repeat=el('repeat');
    var labels={off:'ループ オフ',one:'1曲リピート',all:'全体ループ'};
    repeat.dataset.mode=state.repeatMode;
    repeat.classList.toggle('mode-on',state.repeatMode!=='off');
    repeat.setAttribute('aria-pressed',String(state.repeatMode!=='off'));
    repeat.title=labels[state.repeatMode];
    repeat.setAttribute('aria-label',labels[state.repeatMode]);
  }

  function createButton(label,className,handler){
    var button=document.createElement('button');
    button.type='button'; button.textContent=label; button.className=className||'';
    button.addEventListener('click',handler);
    return button;
  }
  function render(){
    state.visible=filteredRows();
    window.V2Player.setQueue(state.visible);
    el('count').textContent=state.visible.length+'件'+(state.category==='gags'?'（ネタ）':'');
    var list=el('list'); list.replaceChildren();
    if(!state.visible.length){
      var empty=document.createElement('div'); empty.className='empty'; empty.textContent='該当する項目がありません。'; list.appendChild(empty); return;
    }
    state.visible.forEach(function(row,index){
      var article=document.createElement('article');
      article.className='song'+(state.playing && rowKey(state.playing)===rowKey(row)?' playing':'');
      var main=document.createElement('div'); main.className='song-main'; main.tabIndex=0; main.role='button';
      main.setAttribute('aria-label',text(row.title)+' / '+text(row.artist));
      var title=document.createElement('span'); title.className='song-title'; title.textContent=text(row.title)||'（無題）';
      var artist=document.createElement('span'); artist.className='song-artist'; artist.textContent=text(row.artist)||'（アーティスト不明）';
      var meta=document.createElement('span'); meta.className='song-meta';
      meta.textContent=[state.category==='gags'?'ネタ':text(row.kind),displayDate(row.date8||row.lastSungAt)].filter(Boolean).join(' ・ ');
      main.append(title,artist,meta);
      function activate(){
        if(state.playerVisible) window.V2Player.load(index,true);
        else openHistory(row);
      }
      main.addEventListener('click',activate);
      main.addEventListener('keydown',function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();activate();}});
      var side=document.createElement('div'); side.className='song-side';
      var videoId=videoIdFromRow(row);
      if(videoId){
        var thumb=document.createElement('button');
        thumb.type='button';
        thumb.className='song-thumbnail';
        thumb.title=state.playerVisible?'この動画を再生':'この曲の履歴を開く';
        thumb.setAttribute('aria-label',thumb.title);
        var image=document.createElement('img');
        image.src='https://i.ytimg.com/vi/'+encodeURIComponent(videoId)+'/mqdefault.jpg';
        image.alt='';
        image.loading='lazy';
        image.decoding='async';
        thumb.appendChild(image);
        thumb.addEventListener('click',function(event){event.stopPropagation();activate();});
        side.appendChild(thumb);
      }
      side.appendChild(createButton('履歴','history',function(event){event.stopPropagation();openHistory(row);}));
      article.append(main,side); list.appendChild(article);
    });
  }

  async function openHistory(row){
    var dialog=el('history-dialog');
    el('history-title').textContent=text(row.title)+' / '+text(row.artist);
    el('history-list').replaceChildren();
    el('history-status').textContent='読み込み中…';
    if(!dialog.open) dialog.showModal();
    if(!row.historyRef){el('history-status').textContent='履歴参照がありません。';return;}
    try{
      var response=await fetch(new URL(row.historyRef,STATIC_BASE),{cache:'no-store'});
      if(!response.ok) throw new Error('HTTP '+response.status);
      var payload=await response.json();
      var rows=Array.isArray(payload)?payload:(payload.rows||payload.items||payload.history||payload.histories||[]);
      if(!Array.isArray(rows) || !rows.length){el('history-status').textContent='履歴がありません。';return;}
      el('history-status').textContent=rows.length+'件';
      rows.slice().sort(function(a,b){return Number(b.date8||b.date||0)-Number(a.date8||a.date||0);}).forEach(function(item){
        var entry=document.createElement('div'); entry.className='history-entry';
        var date=document.createElement('span'); date.textContent=displayDate(item.date8||item.date)||'日付不明';
        var url=item.dUrl||item.url||item.link||'';
        if(url){var link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='YouTubeで見る';entry.append(date,link);}
        else{var label=document.createElement('span');label.textContent=text(item.dText||item.title||'履歴');entry.append(date,label);}
        el('history-list').appendChild(entry);
      });
    }catch(error){el('history-status').textContent='履歴を読み込めませんでした: '+error.message;}
  }

  function setPlayerVisible(value){
    state.playerVisible=Boolean(value);
    el('player-shell').hidden=!state.playerVisible;
    el('player-toggle').textContent='プレイヤー '+(state.playerVisible?'非表示':'表示');
    el('player-toggle').setAttribute('aria-pressed',String(state.playerVisible));
    if(state.playerVisible){
      window.V2Player.prepare();
      setStatus('曲カードまたは中央の再生ボタンを押してください');
    }else{
      setStatus('R2データ読込済み');
    }
  }

  document.querySelectorAll('[data-kind]').forEach(function(tab){
    tab.addEventListener('click',function(){
      document.querySelectorAll('[data-kind]').forEach(function(node){node.classList.toggle('active',node===tab);});
      state.category=tab.dataset.kind; render();
    });
  });
  el('search').addEventListener('input',render);
  el('player-toggle').addEventListener('click',function(){setPlayerVisible(!state.playerVisible);});
  el('history-close').addEventListener('click',function(){el('history-dialog').close();});
  el('history-dialog').addEventListener('click',function(event){if(event.target===el('history-dialog'))el('history-dialog').close();});
  el('previous').addEventListener('click',window.V2Player.previous);
  el('next').addEventListener('click',window.V2Player.next);
  el('seek-back').addEventListener('click',function(){window.V2Player.seek(-10);});
  el('play-pause').addEventListener('click',window.V2Player.togglePlayback);
  el('seek-forward').addEventListener('click',function(){window.V2Player.seek(10);});
  el('volume').addEventListener('input',function(event){window.V2Player.setVolume(event.target.value);});
  el('shuffle').addEventListener('click',function(){
    var active=this.getAttribute('aria-pressed')!=='true';
    this.setAttribute('aria-pressed',String(active));
    this.title='ランダム再生 '+(active?'オン':'オフ');
    this.setAttribute('aria-label',this.title);
    window.V2Player.setShuffle(active);
  });
  el('repeat').addEventListener('click',function(){
    state.repeatMode=state.repeatMode==='off'?'one':state.repeatMode==='one'?'all':'off';
    updateRepeatControl();
    window.V2Player.setRepeatMode(state.repeatMode);
  });
  updateRepeatControl();
  window.V2Player.on(function(type,detail){
    if(type==='track'){
      state.playing=detail.row;
      el('now-playing').textContent=text(detail.row.title)+' / '+text(detail.row.artist);
      render();
    }else if(type==='state'){
      var isPlaying=detail.state===1;
      var control=el('play-pause');
      control.classList.toggle('is-playing',isPlaying);
      control.title=isPlaying?'一時停止':'再生';
      control.setAttribute('aria-label',control.title);
    }else if(type==='queueend'){
      setStatus('キューの最後まで再生しました');
    }else if(type==='error'){
      var errors={
        2:'動画URLまたは開始位置が無効です',
        5:'この動画をHTML5プレイヤーで再生できません',
        100:'動画が削除済みまたは非公開です',
        101:'動画の所有者が埋め込み再生を許可していません',
        150:'動画の所有者が埋め込み再生を許可していません',
        'invalid-url':'YouTube動画URLを認識できません',
        'api-load':'YouTubeプレイヤーを読み込めませんでした',
        'empty-queue':'再生できる曲が一覧にありません'
      };
      setStatus(errors[detail.code]||('動画を再生できません（YouTubeエラー '+detail.code+'）'));
    }
  });

  Promise.all([fetchRows('songs'),fetchRows('gags')]).then(function(values){
    state.songs=values[0];state.gags=values[1];setStatus('R2データ読込済み');render();
  }).catch(function(error){setStatus('データ読込失敗: '+error.message);});
})();

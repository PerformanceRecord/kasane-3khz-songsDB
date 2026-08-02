(function(){
  'use strict';
  var STATIC_BASE='https://pub-34d8fa96953d472aa7cb424b9daf2d60.r2.dev/public-data/';
  var state={selectedKinds:new Set(['ショート','歌ってみた','歌枠']),showGags:false,songs:[],gags:[],visible:[],playerVisible:false,playing:null,historySelected:null,repeatMode:'off',serverStatus:'loading',serverError:''};
  var desktopHistoryRequest=0;

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
  function serverStatusText(){
    if(state.serverStatus==='loading')return 'サーバー状態：＼uFF3Cﾅｧﾝ／';
    if(state.serverStatus==='error')return 'サーバー状態：非稼働 ｜ '+(state.serverError||'データを取得できません');
    return 'サーバー状態：稼働中 ｜ '+state.visible.length+'件表示中';
  }
  function setStatus(message){
    var status=el('status');
    status.textContent=message;
    status.className='';
    if(!state.playerVisible)status.classList.add('server-status-bar',state.serverStatus);
  }
  function setPlaybackStateLabel(label){
    var display=el('playback-state');
    display.textContent=label||'';
    display.hidden=!label;
  }
  function isDesktopLayout(){return Boolean(window.matchMedia&&window.matchMedia('(min-width: 1100px)').matches);}

  function filteredRows(){
    var source=state.showGags ? state.gags : state.songs.filter(function(row){
      return state.selectedKinds.has(text(row.kind).trim());
    });
    var query=normalize(el('search').value);
    if(!query) return source.slice();
    return source.filter(function(row){
      return normalize(text(row.artist)+' '+text(row.title)).includes(query);
    });
  }
  function syncCategoryControls(){
    document.querySelectorAll('[data-kind]').forEach(function(button){
      var active=button.dataset.kind==='gags'?state.showGags:(!state.showGags&&state.selectedKinds.has(button.dataset.kind));
      button.classList.toggle('active',active);
      button.setAttribute('aria-pressed',String(active));
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

  async function copySong(row,button){
    var value=(text(row.title).trim()+' / '+text(row.artist).trim()).trim();
    try{
      if(navigator.clipboard&&navigator.clipboard.writeText)await navigator.clipboard.writeText(value);
      else{
        var area=document.createElement('textarea');
        area.value=value;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';
        document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();
      }
      var originalTitle=button.title;
      var originalLabel=button.getAttribute('aria-label');
      button.classList.add('copied');
      button.title='コピーしました';
      button.setAttribute('aria-label','コピーしました');
      setStatus('コピーしました：'+value);
      setTimeout(function(){
        button.classList.remove('copied');
        button.title=originalTitle;
        button.setAttribute('aria-label',originalLabel);
      },1200);
    }catch(_error){setStatus('コピーに失敗しました');}
  }
  function closeInlineHistories(except){
    document.querySelectorAll('.song.history-open').forEach(function(card){
      if(card===except)return;
      card.classList.remove('history-open');
      var region=card.querySelector('.inline-history');
      var trigger=card.querySelector('.history');
      if(region){region.hidden=true;region.replaceChildren();}
      if(trigger)trigger.setAttribute('aria-expanded','false');
    });
  }
  function setDesktopHistoryStatus(message,isError){
    var list=el('desktop-history-list');
    list.replaceChildren();
    var status=document.createElement('div');
    status.className='desktop-history-status'+(isError?' error':'');
    status.textContent=message;
    list.appendChild(status);
  }
  function resetDesktopHistory(){
    desktopHistoryRequest++;
    state.historySelected=null;
    document.querySelectorAll('.song.desktop-history-selected').forEach(function(card){
      card.classList.remove('desktop-history-selected');
      var trigger=card.querySelector('.history');
      if(trigger)trigger.setAttribute('aria-expanded','false');
    });
    el('desktop-history-title').textContent='楽曲を選択';
    el('desktop-history-sub').textContent='左側の楽曲または履歴アイコンを選ぶと、ここに履歴を表示します。';
    el('desktop-history-close').hidden=true;
    setDesktopHistoryStatus('履歴はまだ選択されていません。',false);
  }
  async function showDesktopHistory(card,row,trigger){
    var selectedKey=state.historySelected&&rowKey(state.historySelected);
    if(selectedKey&&selectedKey===rowKey(row)){
      resetDesktopHistory();
      return;
    }
    resetDesktopHistory();
    closeInlineHistories();
    state.historySelected=row;
    var request=++desktopHistoryRequest;
    card.classList.add('desktop-history-selected');
    trigger.setAttribute('aria-expanded','true');
    el('desktop-history-title').textContent=[text(row.title).trim(),text(row.artist).trim()].filter(Boolean).join(' / ');
    el('desktop-history-sub').textContent='歌唱履歴を新しい順に表示します。';
    el('desktop-history-close').hidden=false;
    setDesktopHistoryStatus('履歴を読み込み中…',false);
    if(!row.historyRef){
      setDesktopHistoryStatus('履歴参照がありません。',false);
      return;
    }
    try{
      var response=await fetch(new URL(row.historyRef,STATIC_BASE),{cache:'no-store'});
      if(!response.ok)throw new Error('HTTP '+response.status);
      var payload=await response.json();
      var rows=Array.isArray(payload)?payload:(payload.rows||payload.items||payload.history||payload.histories||[]);
      if(request!==desktopHistoryRequest)return;
      if(!Array.isArray(rows)||!rows.length){
        setDesktopHistoryStatus('該当する履歴がありません。',false);
        return;
      }
      rows=rows.slice().sort(function(a,b){return Number(b.date8||b.date||0)-Number(a.date8||a.date||0);});
      el('desktop-history-sub').textContent=rows.length+'件の履歴';
      var list=el('desktop-history-list');
      list.replaceChildren();
      rows.forEach(function(item){
        var url=item.dUrl||item.url||item.link||'';
        var entry=document.createElement(url?'a':'div');
        entry.className='desktop-history-row';
        if(url){entry.href=url;entry.target='_blank';entry.rel='noopener noreferrer';}
        var date=document.createElement('time');
        date.textContent=displayDate(item.date8||item.date)||'日付不明';
        var action=document.createElement('span');
        action.className=url?'desktop-history-link':'desktop-history-no-link';
        action.textContent=url?'▶ 開く':'リンクなし';
        entry.append(date,action);
        list.appendChild(entry);
      });
    }catch(error){
      if(request!==desktopHistoryRequest)return;
      setDesktopHistoryStatus('履歴を取得できませんでした：'+error.message,true);
    }
  }
  async function toggleInlineHistory(card,row,region,trigger){
    if(card.classList.contains('history-open')){
      card.classList.remove('history-open');
      region.hidden=true;region.replaceChildren();
      trigger.setAttribute('aria-expanded','false');
      return;
    }
    closeInlineHistories(card);
    card.classList.add('history-open');
    region.hidden=false;
    trigger.setAttribute('aria-expanded','true');
    region.replaceChildren();
    var loading=document.createElement('div');
    loading.className='inline-history-status';
    loading.textContent='履歴を読み込み中…';
    region.appendChild(loading);
    if(!row.historyRef){loading.textContent='履歴参照がありません。';return;}
    try{
      var response=await fetch(new URL(row.historyRef,STATIC_BASE),{cache:'no-store'});
      if(!response.ok)throw new Error('HTTP '+response.status);
      var payload=await response.json();
      var rows=Array.isArray(payload)?payload:(payload.rows||payload.items||payload.history||payload.histories||[]);
      if(!Array.isArray(rows)||!rows.length){loading.textContent='該当する履歴がありません。';return;}
      rows=rows.slice().sort(function(a,b){return Number(b.date8||b.date||0)-Number(a.date8||a.date||0);});
      region.replaceChildren();
      var heading=document.createElement('div');
      heading.className='inline-history-heading';
      heading.textContent='歌唱履歴 '+rows.length+'件';
      region.appendChild(heading);
      var list=document.createElement('div');
      list.className='inline-history-list';
      rows.forEach(function(item){
        var url=item.dUrl||item.url||item.link||'';
        var entry=document.createElement(url?'a':'div');
        entry.className='inline-history-row';
        if(url){entry.href=url;entry.target='_blank';entry.rel='noopener noreferrer';}
        var date=document.createElement('time');
        date.className='inline-history-date';
        date.textContent=displayDate(item.date8||item.date)||'日付不明';
        var action=document.createElement('span');
        action.className=url?'inline-history-link-label':'inline-history-no-link';
        action.textContent=url?'▶ 開く':'リンクなし';
        entry.append(date,action);list.appendChild(entry);
      });
      region.appendChild(list);
      card.scrollIntoView({behavior:'smooth',block:'nearest'});
    }catch(error){
      loading.className='inline-history-status inline-history-error';
      loading.textContent='履歴を取得できませんでした：'+error.message;
    }
  }

  function openHistory(card,row,region,trigger){
    if(isDesktopLayout())return showDesktopHistory(card,row,trigger);
    resetDesktopHistory();
    return toggleInlineHistory(card,row,region,trigger);
  }

  function createButton(label,className,handler){
    var button=document.createElement('button');
    button.type='button'; button.textContent=label; button.className=className||'';
    button.addEventListener('click',handler);
    return button;
  }
  function setCardActionIcon(button,type){
    button.classList.add('card-icon-button');
    button.innerHTML=type==='history'
      ? '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
    return button;
  }
  function render(){
    state.visible=filteredRows();
    window.V2Player.setQueue(state.visible);
    var selectionLabel=state.showGags?'ネタ':Array.from(state.selectedKinds).join('・');
    el('count').textContent=state.visible.length+'件'+(selectionLabel?'（'+selectionLabel+'）':'');
    if(!state.playerVisible&&state.serverStatus==='ok')setStatus(serverStatusText());
    var list=el('list'); list.replaceChildren();
    if(!state.visible.length){
      var empty=document.createElement('div'); empty.className='empty'; empty.textContent='該当する項目がありません。'; list.appendChild(empty); return;
    }
    var desktopMode=isDesktopLayout();
    state.visible.forEach(function(row,index){
      var article=document.createElement('article');
      var selectedForHistory=Boolean(desktopMode&&state.historySelected&&rowKey(state.historySelected)===rowKey(row));
      article.className='song'+(state.playing && rowKey(state.playing)===rowKey(row)?' playing':'')+(selectedForHistory?' desktop-history-selected':'');
      var main=document.createElement('div'); main.className='song-main'; main.tabIndex=0; main.role='button';
      main.setAttribute('aria-label',text(row.title)+' / '+text(row.artist));
      var title=document.createElement('span'); title.className='song-title'; title.textContent=text(row.title)||'（無題）';
      var artist=document.createElement('span'); artist.className='song-artist'; artist.textContent=text(row.artist)||'（アーティスト不明）';
      var meta=document.createElement('span'); meta.className='song-meta';
      meta.textContent=[state.showGags?'ネタ':text(row.kind),displayDate(row.date8||row.lastSungAt)].filter(Boolean).join(' ・ ');
      main.append(title,artist,meta);
      var region=document.createElement('div');
      region.className='inline-history';
      region.hidden=true;
      region.id='inline-history-'+index;
      var historyButton;
      function activate(){
        if(state.playerVisible) window.V2Player.load(index,true);
        else openHistory(article,row,region,historyButton);
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
      var sideActions=document.createElement('div');
      sideActions.className='song-side-actions';
      historyButton=createButton('','history',function(event){event.stopPropagation();openHistory(article,row,region,historyButton);});
      setCardActionIcon(historyButton,'history');
      historyButton.title='歌唱履歴を表示・閉じる';
      historyButton.setAttribute('aria-label','歌唱履歴を表示・閉じる');
      historyButton.setAttribute('aria-expanded',String(selectedForHistory));
      historyButton.setAttribute('aria-controls',region.id+' desktop-history');
      var copyButton=createButton('','copy',function(event){event.stopPropagation();copySong(row,copyButton);});
      setCardActionIcon(copyButton,'copy');
      copyButton.title='曲名とアーティスト名をコピー';
      copyButton.setAttribute('aria-label','曲名とアーティスト名をコピー');
      sideActions.append(historyButton,copyButton);
      side.appendChild(sideActions);
      article.append(main,side,region); list.appendChild(article);
    });
  }

  var playerAnimationToken=0;
  function animatePlayerShell(show){
    var shell=el('player-shell');
    var token=++playerAnimationToken;
    var wasHidden=shell.hidden;
    var currentHeight=wasHidden?0:shell.getBoundingClientRect().height;
    var currentOpacity=wasHidden?0:Number(getComputedStyle(shell).opacity);
    if(!Number.isFinite(currentOpacity))currentOpacity=show?0:1;
    if(shell.getAnimations)shell.getAnimations().forEach(function(animation){animation.cancel();});
    if(show)shell.hidden=false;
    shell.classList.toggle('is-open',show);
    var reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(reduced||typeof shell.animate!=='function'){
      shell.hidden=!show;
      shell.classList.remove('is-animating');
      return;
    }
    var targetHeight=show?shell.scrollHeight:0;
    shell.classList.add('is-animating');
    var animation=shell.animate([
      {
        height:currentHeight+'px',
        opacity:currentOpacity,
        transform:show?'translateY(-10px) scale(.988)':'translateY(0) scale(1)'
      },
      {
        height:targetHeight+'px',
        opacity:show?1:0,
        transform:show?'translateY(0) scale(1)':'translateY(-8px) scale(.988)'
      }
    ],{
      duration:show?380:260,
      easing:show?'cubic-bezier(.2,.8,.2,1)':'cubic-bezier(.4,0,1,1)',
      fill:'both'
    });
    animation.onfinish=function(){
      if(token!==playerAnimationToken)return;
      shell.hidden=!show;
      shell.classList.remove('is-animating');
      animation.onfinish=null;
      animation.cancel();
    };
  }
  function setPlayerVisible(value){
    state.playerVisible=Boolean(value);
    var toggle=el('player-toggle');
    animatePlayerShell(state.playerVisible);
    toggle.textContent='プレイヤー '+(state.playerVisible?'非表示':'表示');
    toggle.classList.toggle('is-open',state.playerVisible);
    toggle.setAttribute('aria-pressed',String(state.playerVisible));
    if(state.playerVisible){
      window.V2Player.prepare();
      setStatus('曲カードまたは中央の再生ボタンを押してください');
    }else{
      setStatus(serverStatusText());
    }
    render();
  }

  document.querySelectorAll('[data-kind]').forEach(function(button){
    button.addEventListener('click',function(){
      var kind=button.dataset.kind;
      if(kind==='gags'){
        state.showGags=!state.showGags;
      }else{
        if(state.showGags)state.showGags=false;
        if(state.selectedKinds.has(kind))state.selectedKinds.delete(kind);
        else state.selectedKinds.add(kind);
      }
      syncCategoryControls();
      render();
    });
  });
  syncCategoryControls();
  el('search').addEventListener('input',render);
  el('desktop-history-close').addEventListener('click',resetDesktopHistory);
  if(window.matchMedia){
    var desktopLayoutMedia=window.matchMedia('(min-width: 1100px)');
    var handleDesktopLayoutChange=function(event){
      if(event.matches)closeInlineHistories();
      else resetDesktopHistory();
    };
    if(desktopLayoutMedia.addEventListener)desktopLayoutMedia.addEventListener('change',handleDesktopLayoutChange);
    else if(desktopLayoutMedia.addListener)desktopLayoutMedia.addListener(handleDesktopLayoutChange);
  }
  el('now-playing-artist').addEventListener('click',function(){
    var artist=text(state.playing&&state.playing.artist).trim();
    if(!artist)return;
    el('search').value=artist;
    render();
    setStatus('「'+artist+'」の楽曲を表示中（再生は継続します）');
  });
  el('player-toggle').addEventListener('click',function(){setPlayerVisible(!state.playerVisible);});
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
      var title=text(detail.row.title).trim()||'（無題）';
      var artist=text(detail.row.artist).trim();
      var artistControl=el('now-playing-artist');
      setPlaybackStateLabel('');
      el('now-playing').textContent=title;
      el('now-playing-artist-name').textContent=artist;
      el('now-playing-separator').hidden=!artist;
      artistControl.hidden=!artist;
      if(artist){
        artistControl.title='「'+artist+'」で検索';
        artistControl.setAttribute('aria-label','アーティスト「'+artist+'」で検索');
      }
      render();
    }else if(type==='state'){
      var isPlaying=detail.state===1;
      var control=el('play-pause');
      control.classList.toggle('is-playing',isPlaying);
      control.title=isPlaying?'一時停止':'再生';
      control.setAttribute('aria-label',control.title);
      var playbackLabels={0:'再生終了',1:'再生中',2:'一時停止中',3:'読み込み中',5:'再生待機中'};
      setPlaybackStateLabel(playbackLabels[detail.state]||'');
      if(detail.state===1)setStatus('再生中');
      else if(detail.state===2)setStatus('一時停止中');
    }else if(type==='queueend'){
      setPlaybackStateLabel('再生終了');
      setStatus('キューの最後まで再生しました');
    }else if(type==='error'){
      setPlaybackStateLabel('');
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
    state.songs=values[0];
    state.gags=values[1];
    state.serverStatus='ok';
    state.serverError='';
    render();
  }).catch(function(error){
    state.serverStatus='error';
    state.serverError=error.message;
    setStatus(serverStatusText());
  });
})();

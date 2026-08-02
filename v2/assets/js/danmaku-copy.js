(function(){
  'use strict';

  var select=document.getElementById('dm-select');
  var copyButton=document.getElementById('dm-copy');
  var toast=document.getElementById('toast');
  var toastTimer=0;

  if(!select||!copyButton||!toast)return;

  function showToast(message){
    toast.textContent=message;
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer=window.setTimeout(function(){
      toast.classList.remove('show');
    },1400);
  }

  async function copyText(text){
    try{
      if(navigator.clipboard&&navigator.clipboard.writeText){
        await navigator.clipboard.writeText(text);
      }else{
        var textarea=document.createElement('textarea');
        textarea.value=text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      showToast('コピーしました');
    }catch(_error){
      showToast('コピーに失敗しました');
    }
  }

  copyButton.addEventListener('click',function(){
    copyText(select.value||'');
  });
})();

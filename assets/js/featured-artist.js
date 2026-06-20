    (function(){
      const FEATURED_ARTIST = '花彩音_3kHz';

      function syncFeaturedArtistCards(){
        document.querySelectorAll('#mblist .item:not(.item-blank)').forEach(item => {
          const artist = item.querySelector('.artist')?.textContent?.trim() || '';
          item.classList.toggle('item-featured-artist', artist === FEATURED_ARTIST);
        });
      }

      function initFeaturedArtistCards(){
        const list = document.getElementById('mblist');
        if (!list) return;
        syncFeaturedArtistCards();
        new MutationObserver(syncFeaturedArtistCards).observe(list, {
          childList: true,
          subtree: true,
          characterData: true
        });
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initFeaturedArtistCards);
      } else {
        initFeaturedArtistCards();
      }
    })();

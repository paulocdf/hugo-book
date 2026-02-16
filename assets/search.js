'use strict';

{{ $searchDataFile := printf "%s.search-data.json" .Language.Lang }}
{{ $searchData := resources.Get "search-data.json" | resources.ExecuteAsTemplate $searchDataFile . | resources.Minify | resources.Fingerprint }}
{{ $searchConfig := i18n "bookSearchConfig" | default "{}" }}

(function () {
  const searchDataURL = '{{ $searchData.RelPermalink }}';
  const indexConfig = Object.assign({{ $searchConfig }}, {
    doc: {
      id: 'id',
      field: ['title', 'content'],
      store: ['title', 'href', 'section']
    }
  });

  // Modal elements
  const modal = document.getElementById('search-modal');
  const backdrop = document.getElementById('search-modal-backdrop');
  const input = document.getElementById('search-modal-input');
  const results = document.getElementById('search-modal-results');
  const spinner = modal ? modal.querySelector('.search-modal-spinner') : null;

  // Sidebar trigger
  const sidebarInput = document.getElementById('book-search-input');

  if (!modal || !input) return;

  let activeIndex = -1;
  let initialized = false;

  // ── Index initialization ──────────────────────────────
  function initIndex() {
    if (initialized) return Promise.resolve();
    initialized = true;

    if (spinner) spinner.classList.remove('hidden');

    return fetch(searchDataURL)
      .then(function(r) { return r.json(); })
      .then(function(pages) {
        window.bookSearchIndex = FlexSearch.create('balance', indexConfig);
        window.bookSearchIndex.add(pages);
      })
      .finally(function() {
        if (spinner) spinner.classList.add('hidden');
      });
  }

  // ── Modal open / close ────────────────────────────────
  function openModal() {
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    input.value = '';
    clearResults();
    activeIndex = -1;

    initIndex().then(function() {
      input.focus();
    });
  }

  function closeModal() {
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    input.value = '';
    clearResults();
    activeIndex = -1;
  }

  function isOpen() {
    return modal.classList.contains('active');
  }

  // ── Search ────────────────────────────────────────────
  function search() {
    clearResults();
    activeIndex = -1;

    var query = input.value.trim();
    if (!query || !window.bookSearchIndex) return;

    var hits = window.bookSearchIndex.search(query, 10);

    if (hits.length === 0) {
      var empty = document.createElement('li');
      empty.className = 'search-modal-empty';
      empty.textContent = 'No results for "' + query + '"';
      results.appendChild(empty);
      return;
    }

    hits.forEach(function(page) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = page.href;
      a.textContent = page.title;

      if (page.section) {
        var small = document.createElement('small');
        small.textContent = page.section;
        a.appendChild(small);
      }

      li.appendChild(a);
      results.appendChild(li);
    });
  }

  function clearResults() {
    while (results.firstChild) {
      results.removeChild(results.firstChild);
    }
  }

  // ── Keyboard navigation within results ────────────────
  function getLinks() {
    return results.querySelectorAll('a');
  }

  function setActive(index) {
    var links = getLinks();
    if (!links.length) return;

    // Remove previous active
    links.forEach(function(a) { a.classList.remove('active'); });

    // Clamp index
    if (index < 0) index = links.length - 1;
    if (index >= links.length) index = 0;
    activeIndex = index;

    links[activeIndex].classList.add('active');
    links[activeIndex].scrollIntoView({ block: 'nearest' });
  }

  // ── Event listeners ───────────────────────────────────

  // Sidebar input acts as trigger
  if (sidebarInput) {
    sidebarInput.addEventListener('focus', function(e) {
      e.preventDefault();
      sidebarInput.blur();
      openModal();
    });
    sidebarInput.addEventListener('click', function(e) {
      e.preventDefault();
      sidebarInput.blur();
      openModal();
    });
  }

  // Backdrop click closes
  backdrop.addEventListener('click', closeModal);

  // Type-to-search
  input.addEventListener('input', search);

  // Keyboard shortcuts
  document.addEventListener('keydown', function(e) {
    // Cmd+K / Ctrl+K to open modal
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if (isOpen()) {
        closeModal();
      } else {
        openModal();
      }
      return;
    }

    // 's' or '/' hotkeys to open (when not typing)
    if (!isOpen() && (e.key === 's' || e.key === '/')) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      e.preventDefault();
      openModal();
      return;
    }

    // Modal-specific keyboard handling
    if (!isOpen()) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(activeIndex + 1);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(activeIndex - 1);
      return;
    }

    if (e.key === 'Enter') {
      var links = getLinks();
      if (activeIndex >= 0 && links[activeIndex]) {
        e.preventDefault();
        links[activeIndex].click();
        closeModal();
      } else if (links.length > 0) {
        // If nothing selected, go to first result
        e.preventDefault();
        links[0].click();
        closeModal();
      }
      return;
    }
  });
})();

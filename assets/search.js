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
  let useFirestore = false;
  let searchDebounceTimer = null;
  const DEBOUNCE_MS = 150;

  // ── Helper: get base URL ─────────────────────────────
  function getBaseUrl() {
    var manifest = document.querySelector('link[rel="manifest"]');
    if (manifest) return manifest.getAttribute('href').replace('/manifest.json', '');
    return '';
  }

  function viewUrl(noteId) {
    return getBaseUrl() + '/docs/view/?id=' + encodeURIComponent(noteId);
  }

  // ── Helper: derive section label from note ───────────
  function noteSection(note) {
    if (note.destination === 'book-note') return 'Books' + (note.bookTitle ? ' / ' + note.bookTitle : '');
    if (note.destination === 'inbox') return 'Inbox';
    if (note.destination === 'topic') return 'Topics';
    if (note.destination === 'snippets') return 'Snippets' + (note.language ? ' / ' + note.language.charAt(0).toUpperCase() + note.language.slice(1) : '');
    return '';
  }

  // ── Index initialization ──────────────────────────────
  function initIndex() {
    if (initialized) return Promise.resolve();
    initialized = true;

    if (spinner) spinner.classList.remove('hidden');

    // Try IndexedDB (dynamic notes) first
    if (window.dmSync) {
      return window.dmSync.getAllNotes().then(function(notes) {
        if (notes && notes.length > 0) {
          useFirestore = true;
          var pages = notes.map(function(note, idx) {
            return {
              id: idx,
              href: viewUrl(note.id),
              title: note.title || 'Untitled',
              section: noteSection(note),
              content: note.content || ''
            };
          });
          window.bookSearchIndex = FlexSearch.create('balance', indexConfig);
          window.bookSearchIndex.add(pages);
        } else {
          // No cached notes — user may not be signed in
          useFirestore = false;
        }
      }).catch(function() {
        useFirestore = false;
      }).finally(function() {
        if (spinner) spinner.classList.add('hidden');
      });
    }

    // Fallback: static Hugo search data
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

  // ── Re-index when sync completes ─────────────────────
  window.addEventListener('dm-sync-complete', function() {
    if (!window.dmSync) return;
    window.dmSync.getAllNotes().then(function(notes) {
      if (notes && notes.length > 0) {
        useFirestore = true;
        var pages = notes.map(function(note, idx) {
          return {
            id: idx,
            href: viewUrl(note.id),
            title: note.title || 'Untitled',
            section: noteSection(note),
            content: note.content || ''
          };
        });
        window.bookSearchIndex = FlexSearch.create('balance', indexConfig);
        window.bookSearchIndex.add(pages);
        initialized = true;
      }
    });
  });

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
      // If no index available, show sign-in message
      if (!window.bookSearchIndex) {
        showSignInPrompt();
      }
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

  // ── Sign-in prompt ───────────────────────────────────
  function showSignInPrompt() {
    var li = document.createElement('li');
    li.className = 'search-modal-empty';
    li.textContent = 'Sign in to search your notes';
    results.appendChild(li);
  }

  // ── Search ────────────────────────────────────────────
  function search() {
    clearResults();
    activeIndex = -1;

    var query = input.value.trim();
    if (!query) {
      if (!window.bookSearchIndex) {
        showSignInPrompt();
      }
      return;
    }

    if (!window.bookSearchIndex) {
      showSignInPrompt();
      return;
    }

    var hits = window.bookSearchIndex.search(query, 10);

    if (hits.length === 0) {
      var empty = document.createElement('li');
      empty.className = 'search-modal-empty';
      empty.textContent = 'No results for "' + query + '"';
      results.appendChild(empty);
      return;
    }

    hits.forEach(function(page, idx) {
      var li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.id = 'search-result-' + idx;
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
    input.setAttribute('aria-activedescendant', '');
  }

  // ── Keyboard navigation within results ────────────────
  function getLinks() {
    return results.querySelectorAll('a');
  }

  function setActive(index) {
    var links = getLinks();
    if (!links.length) {
      input.setAttribute('aria-activedescendant', '');
      return;
    }

    // Remove previous active
    links.forEach(function(a) { a.parentElement.classList.remove('active'); a.parentElement.removeAttribute('aria-selected'); });

    // Clamp index
    if (index < 0) index = links.length - 1;
    if (index >= links.length) index = 0;
    activeIndex = index;

    var activeLi = links[activeIndex].parentElement;
    activeLi.classList.add('active');
    activeLi.setAttribute('aria-selected', 'true');
    links[activeIndex].scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', activeLi.id || '');
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

  // Type-to-search (debounced)
  input.addEventListener('input', function() {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(search, DEBOUNCE_MS);
  });

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

    // Focus trap: keep Tab cycling within the modal
    if (e.key === 'Tab') {
      var dialog = modal.querySelector('.search-modal-dialog');
      var focusable = dialog.querySelectorAll('input, a, button, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  });
})();

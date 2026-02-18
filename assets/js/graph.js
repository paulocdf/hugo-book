{{ $graphData := resources.Get "js/graph-data.json" | resources.ExecuteAsTemplate "js/graph-data.json" . | resources.Minify | resources.Fingerprint }}

/**
  Digital Memory - Multi-View Knowledge Visualization
  Four view modes for exploring connected notes, books, and topics:
    1. Graph: D3 force-directed network
    2. Grid: Card-based browsable layout
    3. Radial: D3 sunburst hierarchy
    4. Time: D3 time tracking analytics (from todos)
  Supports light/dark theme switching via CSS custom properties.
*/
(function () {
  // =========================================================================
  // Theme helpers
  // =========================================================================
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function isDarkTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t) return t === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function getThemeColors() {
    var dark = isDarkTheme();
    return {
      CATEGORY_COLORS: {
        'books':   { node: cssVar('--accent-blue')   || (dark ? '#64b5f6' : '#1976d2'), glow: dark ? '#1976d2' : '#90caf9' },
        'topics':  { node: cssVar('--accent-green')  || (dark ? '#81c784' : '#388e3c'), glow: dark ? '#388e3c' : '#a5d6a7' },
        'inbox':   { node: cssVar('--accent-orange') || (dark ? '#ffb74d' : '#e65100'), glow: dark ? '#f57c00' : '#ffcc80' },
        'default': { node: dark ? '#90a4ae' : '#78909c', glow: dark ? '#546e7a' : '#b0bec5' }
      },
      ACTIVE_COLOR: dark ? '#ffd54f' : '#f9a825',
      EDGE_COLOR: dark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)',
      EDGE_HOVER_COLOR: dark ? 'rgba(255, 215, 0, 0.6)' : 'rgba(25, 118, 210, 0.5)',
      EDGE_DIM_COLOR: dark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.04)',
      LABEL_COLOR: dark ? 'rgba(255, 255, 255, 0.85)' : 'rgba(0, 0, 0, 0.75)',
      LABEL_SHADOW: dark ? '0 1px 4px rgba(0,0,0,0.8)' : '0 1px 2px rgba(255,255,255,0.8)',
      NODE_STROKE: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
      BG_GRADIENT_START: dark ? '#1a1d23' : '#f8f9fb',
      BG_GRADIENT_END: dark ? '#2d3139' : '#eef1f5',
      text: dark ? 'rgba(255, 255, 255, 0.85)' : 'rgba(0, 0, 0, 0.75)',
      textMuted: dark ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.5)',
      background: dark ? '#161921' : '#ffffff',
      surface1: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
      borderSubtle: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'
    };
  }

  // =========================================================================
  // Config
  // =========================================================================
  const CONFIG = {
    MIN_RADIUS: 8,
    MAX_RADIUS: 32,
    TICKS: 150,
    MAX_LABEL_LENGTH: 24,
    ZOOM_RANGE: [0.3, 4],
    GRAPH_DATA_URL: '{{ $graphData.RelPermalink }}',
    LINK_DISTANCE: 120,
    CHARGE_STRENGTH: -800,
    COLLISION_RADIUS: 50
  };

  // =========================================================================
  // State
  // =========================================================================
  const graphWrapper = document.getElementById('graph-wrapper');
  const gridWrapper = document.getElementById('grid-wrapper');
  const radialWrapper = document.getElementById('radial-wrapper');
  const timeWrapper = document.getElementById('time-wrapper');
  const notesLegend = document.getElementById('notes-legend');
  const timeLegend = document.getElementById('time-legend');
  if (!graphWrapper) return;

  let currentNodeId = -1;
  let nodesSize = {};
  let tooltip = null;
  let cachedData = null;
  let currentView = localStorage.getItem('dm-view-mode') || 'graph';
  let graphRendered = false;
  let gridRendered = false;
  let radialRendered = false;
  let timeRendered = false;

  init();

  // =========================================================================
  // Build graph data from IndexedDB notes
  // =========================================================================
  function getBaseUrl() {
    var manifest = document.querySelector('link[rel="manifest"]');
    if (manifest) return manifest.getAttribute('href').replace('/manifest.json', '');
    return '';
  }

  function destinationToCategory(dest) {
    if (dest === 'book-note') return 'books';
    if (dest === 'topic') return 'topics';
    if (dest === 'inbox') return 'inbox';
    if (dest === 'snippets') return 'snippets';
    return 'default';
  }

  function buildGraphFromNotes(notes) {
    var baseUrl = getBaseUrl();
    var nodes = [];
    var edges = [];
    var edgeSet = {};

    // Build nodes
    notes.forEach(function(note) {
      if (!note.title) return;
      nodes.push({
        id: note.id,
        path: baseUrl + '/docs/view/?id=' + encodeURIComponent(note.id),
        label: note.title,
        number_neighbours: 0,
        category: destinationToCategory(note.destination),
        tags: note.tags || []
      });
    });

    // Build edges from shared tags
    for (var i = 0; i < nodes.length; i++) {
      var tagsA = nodes[i].tags;
      if (!tagsA || !tagsA.length) continue;
      for (var j = i + 1; j < nodes.length; j++) {
        var tagsB = nodes[j].tags;
        if (!tagsB || !tagsB.length) continue;
        // Check for shared tags
        var shared = false;
        for (var ti = 0; ti < tagsA.length; ti++) {
          if (tagsB.indexOf(tagsA[ti]) !== -1) { shared = true; break; }
        }
        if (shared) {
          var key = nodes[i].id < nodes[j].id
            ? nodes[i].id + '|' + nodes[j].id
            : nodes[j].id + '|' + nodes[i].id;
          if (!edgeSet[key]) {
            edgeSet[key] = true;
            edges.push({ source: nodes[i].id, target: nodes[j].id, type: 'tag' });
          }
        }
      }
    }

    // Count neighbours
    edges.forEach(function(edge) {
      nodes.forEach(function(node) {
        if (node.id === edge.source || node.id === edge.target) {
          node.number_neighbours++;
        }
      });
    });

    return { nodes: nodes, edges: edges };
  }

  // =========================================================================
  // Initialization
  // =========================================================================
  function init() {
    createTooltip();
    attachToggleListeners();

    // Try loading from IndexedDB first (dynamic data)
    function loadFromIndexedDB() {
      if (!window.dmSync) return Promise.reject('no dmSync');
      return window.dmSync.getAllNotes().then(function(notes) {
        if (!notes || !notes.length) return Promise.reject('no notes');
        return buildGraphFromNotes(notes);
      });
    }

    function onDataReady(graphData) {
      cachedData = graphData;
      graphRendered = false;
      gridRendered = false;
      radialRendered = false;
      timeRendered = false;
      _allTodos = null;
      currentNodeId = -1;
      nodesSize = {};
      switchView(currentView);
    }

    loadFromIndexedDB()
      .then(onDataReady)
      .catch(function() {
        // Fallback to static JSON (may be empty after migration)
        fetch(CONFIG.GRAPH_DATA_URL)
          .then(function(res) { return res.json(); })
          .then(onDataReady)
          .catch(function(err) { console.error('Graph data load error:', err); });
      });

    // Re-render when notes sync completes
    window.addEventListener('dm-sync-complete', function() {
      loadFromIndexedDB().then(onDataReady).catch(function() {});
    });

    // Re-render time view when todos change
    window.addEventListener('dm-todos-updated', function() {
      if (currentView === 'time') {
        // Refresh cached todos and re-render content area
        if (window.dmSync && window.dmSync.getAllTodos) {
          window.dmSync.getAllTodos().then(function(todos) {
            _allTodos = todos;
            triggerTimeContentUpdate();
          }).catch(function() {});
        }
      } else {
        timeRendered = false; // mark stale for next switch
        _allTodos = null;     // clear cache
      }
    });

    // Re-render active view when theme changes
    var observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        if (m.attributeName === 'data-theme') {
          setTimeout(function() {
            // Force re-render of current view
            graphRendered = false;
            gridRendered = false;
            radialRendered = false;
            timeRendered = false;
            _allTodos = null;
            currentNodeId = -1;
            nodesSize = {};
            renderCurrentView();
          }, 50);
        }
      });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  // =========================================================================
  // View switching
  // =========================================================================
  function attachToggleListeners() {
    document.querySelectorAll('.view-toggle-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        switchView(btn.dataset.view);
      });
    });
  }

  function switchView(viewName) {
    currentView = viewName;
    localStorage.setItem('dm-view-mode', viewName);

    // Update toggle buttons
    document.querySelectorAll('.view-toggle-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    // Update view containers
    document.querySelectorAll('.view-container').forEach(function(container) {
      container.classList.remove('active');
    });

    var targetId = viewName + '-wrapper';
    var target = document.getElementById(targetId);
    if (target) {
      target.classList.add('active');
    }

    // Toggle legends: notes legend for graph/grid/radial, time legend for time
    if (notesLegend) notesLegend.style.display = (viewName === 'time') ? 'none' : '';
    if (timeLegend) timeLegend.style.display = (viewName === 'time') ? '' : 'none';

    renderCurrentView();
  }

  function renderCurrentView() {
    // Time view has its own data source (todos), so it doesn't depend on cachedData
    if (currentView === 'time' && !timeRendered) {
      renderTimeView();
      timeRendered = true;
      return;
    }

    if (!cachedData) return;

    if (currentView === 'graph' && !graphRendered) {
      initGraph(
        cachedData.nodes.map(function(n) { return Object.assign({}, n); }),
        cachedData.edges.map(function(e) { return { source: e.source.id || e.source, target: e.target.id || e.target, type: e.type }; })
      );
      graphRendered = true;
    } else if (currentView === 'grid' && !gridRendered) {
      renderGridView(cachedData);
      gridRendered = true;
    } else if (currentView === 'radial' && !radialRendered) {
      renderSunburstView(cachedData);
      radialRendered = true;
    }
  }

  // =========================================================================
  // Tooltip
  // =========================================================================
  function createTooltip() {
    tooltip = document.createElement('div');
    tooltip.className = 'graph-tooltip';
    tooltip.style.cssText = 'position:fixed;pointer-events:none;opacity:0;transition:opacity 0.2s ease;z-index:200;';
    document.body.appendChild(tooltip);
  }

  // =========================================================================
  // GRAPH VIEW (existing force-directed)
  // =========================================================================
  function initGraph(nodesData, linksData) {
    var theme = getThemeColors();

    function getCategoryColor(category) {
      return theme.CATEGORY_COLORS[category] || theme.CATEGORY_COLORS['default'];
    }

    // Clear any existing SVG
    graphWrapper.querySelectorAll('svg').forEach(function(el) { el.remove(); });

    const width = graphWrapper.clientWidth;
    const height = graphWrapper.clientHeight;

    nodesData.forEach(function(node) {
      if (isCurrentPath(node.path)) currentNodeId = node.id;
      nodesSize[node.id] = computeNodeSize(node);
    });

    const svg = d3.select(graphWrapper)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const defs = svg.append('defs');

    // Glow filters
    Object.entries(theme.CATEGORY_COLORS).forEach(function([cat, colors]) {
      const filter = defs.append('filter')
        .attr('id', 'glow-' + cat)
        .attr('x', '-50%').attr('y', '-50%')
        .attr('width', '200%').attr('height', '200%');
      filter.append('feGaussianBlur')
        .attr('stdDeviation', '3')
        .attr('result', 'coloredBlur');
      filter.append('feFlood')
        .attr('flood-color', colors.glow)
        .attr('flood-opacity', '0.6')
        .attr('result', 'glowColor');
      filter.append('feComposite')
        .attr('in', 'glowColor')
        .attr('in2', 'coloredBlur')
        .attr('operator', 'in')
        .attr('result', 'softGlow');
      const merge = filter.append('feMerge');
      merge.append('feMergeNode').attr('in', 'softGlow');
      merge.append('feMergeNode').attr('in', 'SourceGraphic');
    });

    // Active glow
    const activeFilter = defs.append('filter')
      .attr('id', 'glow-active')
      .attr('x', '-50%').attr('y', '-50%')
      .attr('width', '200%').attr('height', '200%');
    activeFilter.append('feGaussianBlur')
      .attr('stdDeviation', '6')
      .attr('result', 'coloredBlur');
    activeFilter.append('feFlood')
      .attr('flood-color', theme.ACTIVE_COLOR)
      .attr('flood-opacity', '0.8')
      .attr('result', 'glowColor');
    activeFilter.append('feComposite')
      .attr('in', 'glowColor')
      .attr('in2', 'coloredBlur')
      .attr('operator', 'in')
      .attr('result', 'softGlow');
    const activeMerge = activeFilter.append('feMerge');
    activeMerge.append('feMergeNode').attr('in', 'softGlow');
    activeMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    const g = svg.append('g');

    // Links
    const links = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(linksData)
      .enter()
      .append('line')
      .attr('stroke', theme.EDGE_COLOR)
      .attr('stroke-width', function(d) { return d.type === 'backlink' ? 2 : 1.5; })
      .attr('stroke-dasharray', function(d) { return d.type === 'tag' ? '6,4' : 'none'; });

    // Nodes
    const nodes = g.append('g')
      .attr('class', 'nodes')
      .selectAll('circle')
      .data(nodesData)
      .enter()
      .append('circle')
      .attr('r', function(d) { return nodesSize[d.id]; })
      .attr('fill', function(d) { return d.id === currentNodeId ? theme.ACTIVE_COLOR : getCategoryColor(d.category).node; })
      .attr('filter', function(d) { return d.id === currentNodeId ? 'url(#glow-active)' : 'url(#glow-' + (d.category || 'default') + ')'; })
      .attr('stroke', function(d) { return d.id === currentNodeId ? theme.ACTIVE_COLOR : theme.NODE_STROKE; })
      .attr('stroke-width', function(d) { return d.id === currentNodeId ? 2 : 1; })
      .style('cursor', 'pointer');

    // Labels
    const labels = g.append('g')
      .attr('class', 'labels')
      .selectAll('text')
      .data(nodesData)
      .enter()
      .append('text')
      .text(function(d) { return shorten(d.label.replace(/_/g, ''), CONFIG.MAX_LABEL_LENGTH); })
      .attr('fill', theme.LABEL_COLOR)
      .attr('text-anchor', 'middle')
      .attr('font-size', '0.75rem')
      .attr('font-weight', function(d) { return d.id === currentNodeId ? '600' : '400'; })
      .attr('dy', function(d) { return -(nodesSize[d.id] + 8); })
      .style('cursor', 'pointer')
      .style('text-shadow', theme.LABEL_SHADOW);

    // Simulation
    const simulation = d3.forceSimulation(nodesData)
      .force('charge', d3.forceManyBody().strength(CONFIG.CHARGE_STRENGTH))
      .force('link', d3.forceLink(linksData).id(function(d) { return d.id; }).distance(CONFIG.LINK_DISTANCE))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('x', d3.forceX(width / 2).strength(0.1))
      .force('y', d3.forceY(height / 2).strength(0.1))
      .force('collision', d3.forceCollide().radius(CONFIG.COLLISION_RADIUS))
      .stop();

    d3.range(CONFIG.TICKS).forEach(simulation.tick);

    // Position elements (hidden for animation)
    nodes.attr('cx', function(d) { return d.x; }).attr('cy', function(d) { return d.y; })
      .attr('opacity', 0).attr('r', 0);
    labels.attr('x', function(d) { return d.x; }).attr('y', function(d) { return d.y; })
      .attr('opacity', 0);
    links
      .attr('x1', function(d) { return d.source.x; }).attr('y1', function(d) { return d.source.y; })
      .attr('x2', function(d) { return d.target.x; }).attr('y2', function(d) { return d.target.y; })
      .attr('opacity', 0);

    // Animated entrance
    nodes.transition()
      .delay(function(d, i) { return i * 80; })
      .duration(600)
      .ease(d3.easeBackOut.overshoot(1.2))
      .attr('opacity', 1)
      .attr('r', function(d) { return nodesSize[d.id]; });

    labels.transition()
      .delay(function(d, i) { return i * 80 + 300; })
      .duration(400)
      .ease(d3.easeQuadOut)
      .attr('opacity', 1);

    var nodeCount = nodesData.length;
    links.transition()
      .delay(function() { return nodeCount * 80 + 200; })
      .duration(500)
      .ease(d3.easeQuadOut)
      .attr('opacity', 1);

    // Interactions
    nodes
      .on('click', function(event, d) { window.location = d.path; })
      .on('mouseover', function(event, d) { onHover(d, linksData, nodes, links, labels, event, theme); })
      .on('mousemove', function(event) { moveTooltip(event); })
      .on('mouseout', function() { onHoverEnd(nodes, links, labels, theme); });

    labels
      .on('click', function(event, d) { window.location = d.path; })
      .on('mouseover', function(event, d) { onHover(d, linksData, nodes, links, labels, event, theme); })
      .on('mousemove', function(event) { moveTooltip(event); })
      .on('mouseout', function() { onHoverEnd(nodes, links, labels, theme); });

    // Zoom
    const zoom = d3.zoom()
      .scaleExtent(CONFIG.ZOOM_RANGE)
      .on('zoom', function(event) { g.attr('transform', event.transform); });

    svg.call(zoom);

    // Auto-fit
    const padding = 80;
    const xExtent = d3.extent(nodesData, function(d) { return d.x; });
    const yExtent = d3.extent(nodesData, function(d) { return d.y; });
    const graphWidth = (xExtent[1] - xExtent[0]) || 1;
    const graphHeight = (yExtent[1] - yExtent[0]) || 1;
    const graphCenterX = (xExtent[0] + xExtent[1]) / 2;
    const graphCenterY = (yExtent[0] + yExtent[1]) / 2;

    const fitScale = Math.min(
      (width - padding * 2) / graphWidth,
      (height - padding * 2) / graphHeight,
      1.5
    );

    svg.call(
      zoom.transform,
      d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(fitScale)
        .translate(-graphCenterX, -graphCenterY)
    );

    // Responsive resize
    var resizeObserver = new ResizeObserver(function() {
      var newW = graphWrapper.clientWidth;
      var newH = graphWrapper.clientHeight;
      svg.attr('width', newW).attr('height', newH);
    });
    resizeObserver.observe(graphWrapper);
  }

  // =========================================================================
  // GRID VIEW
  // =========================================================================
  function renderGridView(data) {
    if (!gridWrapper) return;
    gridWrapper.innerHTML = '';

    var theme = getThemeColors();

    data.nodes.forEach(function(node) {
      var card = document.createElement('div');
      card.className = 'grid-card';
      card.dataset.category = node.category || 'default';

      var categoryLabel = (node.category || 'note');
      categoryLabel = categoryLabel.charAt(0).toUpperCase() + categoryLabel.slice(1);

      // Tags (max 5)
      var tags = node.tags || [];
      var maxTags = 5;
      var visibleTags = tags.slice(0, maxTags);
      var extraCount = tags.length - maxTags;

      var tagsHtml = visibleTags.map(function(tag) {
        return '<span class="grid-card-tag">' + tag + '</span>';
      }).join('');

      if (extraCount > 0) {
        tagsHtml += '<span class="grid-card-tag-more">+' + extraCount + ' more</span>';
      }

      var connectionsText = node.number_neighbours + ' connection' + (node.number_neighbours !== 1 ? 's' : '');

      card.innerHTML =
        '<a href="' + node.path + '" class="grid-card-title">' + node.label + '</a>' +
        '<div class="grid-card-meta">' +
          '<span class="grid-card-category ' + (node.category || 'default') + '">' + categoryLabel + '</span>' +
          '<span class="grid-card-connections">' + connectionsText + '</span>' +
        '</div>' +
        (tags.length > 0 ? '<div class="grid-card-tags">' + tagsHtml + '</div>' : '');

      card.addEventListener('click', function(e) {
        if (e.target.tagName !== 'A') {
          window.location.href = node.path;
        }
      });

      gridWrapper.appendChild(card);
    });

    // Animate cards in
    var cards = gridWrapper.querySelectorAll('.grid-card');
    cards.forEach(function(card, i) {
      card.style.opacity = '0';
      card.style.transform = 'translateY(20px)';
      setTimeout(function() {
        card.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
      }, i * 60);
    });
  }

  // =========================================================================
  // SUNBURST VIEW
  // =========================================================================
  function renderSunburstView(data) {
    if (!radialWrapper) return;
    radialWrapper.innerHTML = '';

    var theme = getThemeColors();
    var width = radialWrapper.clientWidth;
    var height = radialWrapper.clientHeight || 550;
    var radius = Math.min(width, height) / 2 - 40;

    // Build hierarchy: root -> categories -> items
    var categories = {};
    data.nodes.forEach(function(node) {
      var cat = node.category || 'default';
      if (!categories[cat]) {
        categories[cat] = [];
      }
      categories[cat].push(node);
    });

    var hierarchyData = {
      name: 'Digital Memory',
      children: Object.entries(categories).map(function([catName, nodes]) {
        return {
          name: catName,
          children: nodes.map(function(n) {
            return {
              name: n.label,
              path: n.path,
              value: Math.max(1, (n.number_neighbours || 0) + 1),
              tags: n.tags,
              category: n.category
            };
          })
        };
      })
    };

    var root = d3.hierarchy(hierarchyData)
      .sum(function(d) { return d.value || 0; })
      .sort(function(a, b) { return b.value - a.value; });

    var partition = d3.partition()
      .size([2 * Math.PI, radius])
      .padding(0.02);

    partition(root);

    var svg = d3.select(radialWrapper)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    var g = svg.append('g')
      .attr('transform', 'translate(' + (width / 2) + ',' + (height / 2) + ')');

    // Arc generator
    var arc = d3.arc()
      .startAngle(function(d) { return d.x0; })
      .endAngle(function(d) { return d.x1; })
      .innerRadius(function(d) { return d.y0; })
      .outerRadius(function(d) { return d.y1 - 1; })
      .cornerRadius(3);

    // Color function
    function getArcColor(d) {
      var cat;
      if (d.depth === 1) {
        cat = d.data.name.toLowerCase();
      } else if (d.depth >= 2) {
        cat = d.parent ? d.parent.data.name.toLowerCase() : '';
      } else {
        return theme.CATEGORY_COLORS['default'].node;
      }
      if (cat === 'books') return theme.CATEGORY_COLORS['books'].node;
      if (cat === 'topics') return theme.CATEGORY_COLORS['topics'].node;
      if (cat === 'inbox') return theme.CATEGORY_COLORS['inbox'].node;
      return theme.CATEGORY_COLORS['default'].node;
    }

    // Draw arcs (skip root)
    var descendants = root.descendants().filter(function(d) { return d.depth > 0; });

    var arcs = g.selectAll('path')
      .data(descendants)
      .enter()
      .append('path')
      .attr('class', 'sunburst-arc')
      .attr('fill', getArcColor)
      .attr('fill-opacity', function(d) { return d.depth === 1 ? 0.6 : 0.85; })
      .attr('stroke', theme.background)
      .attr('stroke-width', 2)
      .style('cursor', function(d) { return d.data.path ? 'pointer' : 'default'; });

    // Animate arcs in from zero
    arcs
      .attr('d', d3.arc()
        .startAngle(function(d) { return d.x0; })
        .endAngle(function(d) { return d.x0; }) // start collapsed
        .innerRadius(function(d) { return d.y0; })
        .outerRadius(function(d) { return d.y1 - 1; })
        .cornerRadius(3)
      )
      .transition()
      .delay(function(d) { return d.depth * 200; })
      .duration(800)
      .ease(d3.easeQuadOut)
      .attrTween('d', function(d) {
        var interpolate = d3.interpolate(d.x0, d.x1);
        return function(t) {
          return d3.arc()
            .startAngle(d.x0)
            .endAngle(interpolate(t))
            .innerRadius(d.y0)
            .outerRadius(d.y1 - 1)
            .cornerRadius(3)();
        };
      });

    // Interaction
    arcs
      .on('click', function(event, d) {
        if (d.data.path) {
          window.location.href = d.data.path;
        }
      })
      .on('mouseover', function(event, d) {
        d3.select(this)
          .transition().duration(150)
          .attr('fill-opacity', 1)
          .attr('stroke-width', 3);

        var content = '<div class="graph-tooltip-title">' + d.data.name + '</div>';
        if (d.data.category) {
          var catLabel = d.data.category.charAt(0).toUpperCase() + d.data.category.slice(1);
          content += '<div class="graph-tooltip-category">' + catLabel + '</div>';
        }
        if (d.depth === 1) {
          content += '<div class="graph-tooltip-connections">' + d.children.length + ' item' + (d.children.length !== 1 ? 's' : '') + '</div>';
        }
        if (d.data.tags && d.data.tags.length > 0) {
          var tagHtml = d.data.tags.slice(0, 4).map(function(t) {
            return '<span class="graph-tag">' + t + '</span>';
          }).join(' ');
          content += '<div class="graph-tooltip-tags">' + tagHtml + '</div>';
        }
        tooltip.innerHTML = content;
        tooltip.style.opacity = '1';
        moveTooltip(event);
      })
      .on('mousemove', function(event) {
        moveTooltip(event);
      })
      .on('mouseout', function(event, d) {
        d3.select(this)
          .transition().duration(200)
          .attr('fill-opacity', d.depth === 1 ? 0.6 : 0.85)
          .attr('stroke-width', 2);
        tooltip.style.opacity = '0';
      });

    // Category labels (depth 1) — curved along the arc
    var categoryArcs = descendants.filter(function(d) { return d.depth === 1; });

    categoryArcs.forEach(function(d) {
      var angle = (d.x0 + d.x1) / 2;
      var r = (d.y0 + d.y1) / 2;
      var x = Math.sin(angle) * r;
      var y = -Math.cos(angle) * r;
      var rotation = (angle * 180 / Math.PI);

      // Flip text that would be upside down
      var shouldFlip = rotation > 90 && rotation < 270;
      var textRotation = shouldFlip ? rotation - 180 : rotation;
      var labelText = d.data.name.charAt(0).toUpperCase() + d.data.name.slice(1);

      g.append('text')
        .attr('class', 'sunburst-label')
        .attr('transform', 'translate(' + x + ',' + y + ') rotate(' + textRotation + ')')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .text(labelText)
        .style('fill', theme.text)
        .attr('opacity', 0)
        .transition()
        .delay(400)
        .duration(500)
        .attr('opacity', 1);
    });

    // Item labels (depth 2) — only show if arc is wide enough
    var itemArcs = descendants.filter(function(d) {
      return d.depth === 2 && (d.x1 - d.x0) > 0.15; // only wide-enough arcs
    });

    itemArcs.forEach(function(d) {
      var angle = (d.x0 + d.x1) / 2;
      var r = (d.y0 + d.y1) / 2;
      var x = Math.sin(angle) * r;
      var y = -Math.cos(angle) * r;
      var rotation = (angle * 180 / Math.PI);
      var shouldFlip = rotation > 90 && rotation < 270;
      var textRotation = shouldFlip ? rotation - 180 : rotation;

      g.append('text')
        .attr('class', 'sunburst-item-label')
        .attr('transform', 'translate(' + x + ',' + y + ') rotate(' + textRotation + ')')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .text(shorten(d.data.name, 18))
        .style('fill', theme.text)
        .attr('opacity', 0)
        .transition()
        .delay(700)
        .duration(500)
        .attr('opacity', 0.9);
    });

    // Center circle with count
    g.append('circle')
      .attr('r', root.y1 ? 0 : 30)
      .attr('fill', 'none');

    var centerGroup = g.append('g').attr('class', 'sunburst-center');

    centerGroup.append('text')
      .attr('class', 'sunburst-center-count')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('dy', '-0.3em')
      .text(data.nodes.length)
      .style('fill', theme.text)
      .style('font-size', '2rem')
      .style('font-weight', '700')
      .attr('opacity', 0)
      .transition()
      .delay(300)
      .duration(500)
      .attr('opacity', 1);

    centerGroup.append('text')
      .attr('class', 'sunburst-center-label')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('dy', '1.2em')
      .text('notes')
      .style('fill', theme.textMuted)
      .style('font-size', '0.8rem')
      .style('text-transform', 'uppercase')
      .style('letter-spacing', '0.1em')
      .attr('opacity', 0)
      .transition()
      .delay(300)
      .duration(500)
      .attr('opacity', 1);

    // Responsive resize
    var resizeObserver = new ResizeObserver(function() {
      var newW = radialWrapper.clientWidth;
      var newH = radialWrapper.clientHeight;
      svg.attr('width', newW).attr('height', newH);
      g.attr('transform', 'translate(' + (newW / 2) + ',' + (newH / 2) + ')');
    });
    resizeObserver.observe(radialWrapper);
  }

  // =========================================================================
  // TIME VIEW — todo time tracking analytics
  // =========================================================================
  var _allTodos = null; // cached across filter changes
  var _timeFilterState = {
    mode: localStorage.getItem('dm-time-filter') || 'all',
    customFrom: localStorage.getItem('dm-time-custom-from') || '',
    customTo: localStorage.getItem('dm-time-custom-to') || ''
  };

  function renderTimeView() {
    if (!timeWrapper) return;
    timeWrapper.innerHTML = '';

    var theme = getThemeColors();

    // Load todos from IndexedDB
    if (!window.dmSync || !window.dmSync.getAllTodos) {
      showTimeEmpty(timeWrapper, 'Sync not available', 'Time tracking data requires sign-in and sync.');
      return;
    }

    window.dmSync.getAllTodos().then(function(todos) {
      if (!todos || !todos.length) {
        showTimeEmpty(timeWrapper, 'No tasks yet', 'Create tasks in the Inbox to see time tracking analytics here.');
        return;
      }

      _allTodos = todos;

      // ---- Build filter bar ----
      var filterBar = buildTimeFilterBar();
      timeWrapper.appendChild(filterBar.bar);
      timeWrapper.appendChild(filterBar.customRow);

      // ---- Content area (swapped on filter change) ----
      var contentArea = document.createElement('div');
      contentArea.className = 'time-content-area';
      timeWrapper.appendChild(contentArea);

      // Initial render
      renderTimeContent(contentArea, todos, theme, true);

    }).catch(function(err) {
      console.error('Time view: failed to load todos', err);
      showTimeEmpty(timeWrapper, 'Error loading data', 'Could not load time tracking data.');
    });
  }

  function buildTimeFilterBar() {
    var presets = [
      { key: 'week', label: 'Week' },
      { key: 'month', label: 'Month' },
      { key: 'year', label: 'Year' },
      { key: 'all', label: 'All' },
      { key: 'custom', label: 'Custom' }
    ];

    var bar = document.createElement('div');
    bar.className = 'time-filter-bar';

    var segment = document.createElement('div');
    segment.className = 'time-filter-segment';

    presets.forEach(function(preset) {
      var btn = document.createElement('button');
      btn.className = 'time-filter-btn' + (_timeFilterState.mode === preset.key ? ' active' : '');
      btn.textContent = preset.label;
      btn.dataset.filter = preset.key;
      btn.addEventListener('click', function() {
        onTimeFilterClick(preset.key);
      });
      segment.appendChild(btn);
    });

    bar.appendChild(segment);

    // Custom date row
    var customRow = document.createElement('div');
    customRow.className = 'time-filter-custom-row' + (_timeFilterState.mode === 'custom' ? ' visible' : '');
    customRow.id = 'time-custom-row';

    var fromInput = document.createElement('input');
    fromInput.type = 'date';
    fromInput.className = 'time-filter-date-input';
    fromInput.id = 'time-custom-from';
    fromInput.value = _timeFilterState.customFrom;

    var sep = document.createElement('span');
    sep.className = 'time-filter-date-sep';
    sep.textContent = 'to';

    var toInput = document.createElement('input');
    toInput.type = 'date';
    toInput.className = 'time-filter-date-input';
    toInput.id = 'time-custom-to';
    toInput.value = _timeFilterState.customTo;

    var applyBtn = document.createElement('button');
    applyBtn.className = 'time-filter-apply-btn';
    applyBtn.textContent = 'Apply';
    applyBtn.addEventListener('click', function() {
      onCustomDateApply();
    });

    customRow.appendChild(fromInput);
    customRow.appendChild(sep);
    customRow.appendChild(toInput);
    customRow.appendChild(applyBtn);

    // Also apply on Enter key in date inputs
    fromInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') onCustomDateApply(); });
    toInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') onCustomDateApply(); });

    return { bar: bar, customRow: customRow };
  }

  function onTimeFilterClick(filterKey) {
    _timeFilterState.mode = filterKey;
    localStorage.setItem('dm-time-filter', filterKey);

    // Update active state on buttons
    document.querySelectorAll('.time-filter-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.filter === filterKey);
    });

    // Toggle custom row
    var customRow = document.getElementById('time-custom-row');
    if (customRow) {
      customRow.classList.toggle('visible', filterKey === 'custom');
    }

    // If custom, don't re-render yet (wait for Apply)
    if (filterKey === 'custom') return;

    triggerTimeContentUpdate();
  }

  function onCustomDateApply() {
    var fromEl = document.getElementById('time-custom-from');
    var toEl = document.getElementById('time-custom-to');
    if (!fromEl || !toEl) return;

    _timeFilterState.customFrom = fromEl.value;
    _timeFilterState.customTo = toEl.value;
    localStorage.setItem('dm-time-custom-from', fromEl.value);
    localStorage.setItem('dm-time-custom-to', toEl.value);

    triggerTimeContentUpdate();
  }

  function triggerTimeContentUpdate() {
    var contentArea = timeWrapper ? timeWrapper.querySelector('.time-content-area') : null;
    if (!contentArea || !_allTodos) return;

    var theme = getThemeColors();

    // Fade out
    contentArea.classList.add('fading');
    setTimeout(function() {
      renderTimeContent(contentArea, _allTodos, theme, false);
      contentArea.classList.remove('fading');
    }, 250);
  }

  function getTimeFilterRange() {
    var now = new Date();
    var mode = _timeFilterState.mode;

    if (mode === 'week') {
      var weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return { from: weekAgo, to: now };
    }
    if (mode === 'month') {
      var monthAgo = new Date(now);
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      return { from: monthAgo, to: now };
    }
    if (mode === 'year') {
      var yearAgo = new Date(now);
      yearAgo.setFullYear(yearAgo.getFullYear() - 1);
      return { from: yearAgo, to: now };
    }
    if (mode === 'custom') {
      var from = _timeFilterState.customFrom ? new Date(_timeFilterState.customFrom + 'T00:00:00') : null;
      var to = _timeFilterState.customTo ? new Date(_timeFilterState.customTo + 'T23:59:59') : null;
      return { from: from, to: to };
    }
    // 'all'
    return { from: null, to: null };
  }

  function filterTodosByTimeRange(todos, range) {
    if (!range.from && !range.to) return todos;

    return todos.filter(function(t) {
      // Use completedAt for completed tasks
      var dateVal = t.completedAt || t.updatedAt || t.createdAt;
      if (!dateVal) return true; // include if no date

      // Handle Firestore timestamps and date strings
      var d;
      if (dateVal.toDate) {
        d = dateVal.toDate();
      } else if (dateVal.seconds) {
        d = new Date(dateVal.seconds * 1000);
      } else {
        d = new Date(dateVal);
      }

      if (isNaN(d.getTime())) return true; // include if unparseable

      if (range.from && d < range.from) return false;
      if (range.to && d > range.to) return false;
      return true;
    });
  }

  function renderTimeContent(contentArea, allTodos, theme, animate) {
    contentArea.innerHTML = '';

    var range = getTimeFilterRange();

    // Filter ALL todos by range first, then filter to completed parents
    var todosInRange = filterTodosByTimeRange(allTodos, range);
    var completedTodos = todosInRange.filter(function(t) { return t.done && t.actualMin != null && !t.parentId; });

    if (!completedTodos.length) {
      var modeLabel = _timeFilterState.mode === 'custom' ? 'this date range' :
                      _timeFilterState.mode === 'all' ? '' :
                      'the last ' + _timeFilterState.mode;
      var emptyMsg = modeLabel ? 'No completed tasks in ' + modeLabel + '.' : 'No completed tasks yet.';
      contentArea.innerHTML =
        '<div class="time-empty-state">' +
          '<div class="time-empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>' +
          '<div class="time-empty-title">No data</div>' +
          '<div class="time-empty-text">' + emptyMsg + '</div>' +
        '</div>';
      // Clear legend
      if (timeLegend) timeLegend.innerHTML = '';
      return;
    }

    // ---- Compute stats ----
    var totalEstimated = 0;
    var totalActual = 0;
    completedTodos.forEach(function(t) {
      totalEstimated += (t.estimatedMin || 25);
      totalActual += (t.actualMin || 0);
    });
    var totalPomodoros = Math.round((totalActual / 25) * 10) / 10;

    // ---- Build category data ----
    var categoryMap = {};
    completedTodos.forEach(function(t) {
      var cat = t.category || 'Uncategorized';
      if (!categoryMap[cat]) {
        categoryMap[cat] = { estimated: 0, actual: 0, count: 0 };
      }
      categoryMap[cat].estimated += (t.estimatedMin || 25);
      categoryMap[cat].actual += (t.actualMin || 0);
      categoryMap[cat].count++;
    });

    var categoryData = Object.keys(categoryMap).map(function(name) {
      return {
        name: name,
        estimated: categoryMap[name].estimated,
        actual: categoryMap[name].actual,
        count: categoryMap[name].count
      };
    }).sort(function(a, b) { return b.actual - a.actual; });

    // ---- Color palette for categories ----
    var palette = [
      '#64b5f6', '#81c784', '#ffb74d', '#ef5350', '#ba68c8',
      '#4dd0e1', '#fff176', '#a1887f', '#90a4ae', '#f06292'
    ];

    function catColor(i) { return palette[i % palette.length]; }

    // ---- Summary stat cards ----
    var statRow = document.createElement('div');
    statRow.className = 'time-stat-row';
    statRow.innerHTML =
      '<div class="time-stat-card"><div class="time-stat-value">' + completedTodos.length + '</div><div class="time-stat-label">Completed</div></div>' +
      '<div class="time-stat-card"><div class="time-stat-value">' + totalActual + '<span style="font-size:0.9rem;font-weight:400;">m</span></div><div class="time-stat-label">Actual Time</div></div>' +
      '<div class="time-stat-card"><div class="time-stat-value">' + totalEstimated + '<span style="font-size:0.9rem;font-weight:400;">m</span></div><div class="time-stat-label">Estimated</div></div>' +
      '<div class="time-stat-card"><div class="time-stat-value">' + totalPomodoros + '</div><div class="time-stat-label">Pomodoros</div></div>';
    contentArea.appendChild(statRow);

    // Animate stat cards
    if (animate) {
      statRow.querySelectorAll('.time-stat-card').forEach(function(card, i) {
        card.style.opacity = '0';
        card.style.transform = 'translateY(12px)';
        setTimeout(function() {
          card.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
          card.style.opacity = '1';
          card.style.transform = 'translateY(0)';
        }, i * 100);
      });
    }

    // ---- Two-panel grid ----
    var grid = document.createElement('div');
    grid.className = 'time-view-grid';
    contentArea.appendChild(grid);

    // Panel 1: Category donut chart
    var donutPanel = document.createElement('div');
    donutPanel.className = 'time-chart-panel';
    donutPanel.innerHTML = '<div class="time-chart-title">Time by Category</div>';
    grid.appendChild(donutPanel);

    // Panel 2: Estimated vs Actual bar chart
    var barPanel = document.createElement('div');
    barPanel.className = 'time-chart-panel';
    barPanel.innerHTML = '<div class="time-chart-title">Estimated vs Actual</div>';
    grid.appendChild(barPanel);

    // ---- Donut Chart ----
    renderDonutChart(donutPanel, categoryData, catColor, theme);

    // ---- Grouped Bar Chart ----
    renderComparisonChart(barPanel, categoryData, catColor, theme);

    // ---- Update time legend ----
    if (timeLegend) {
      timeLegend.innerHTML = categoryData.map(function(cat, i) {
        return '<div class="legend-item">' +
          '<span class="legend-dot" style="background:' + catColor(i) + ';box-shadow:0 0 6px ' + catColor(i) + '40;"></span>' +
          '<span>' + cat.name + '</span>' +
        '</div>';
      }).join('');
    }
  }

  function showTimeEmpty(container, title, text) {
    container.innerHTML =
      '<div class="time-empty-state">' +
        '<div class="time-empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>' +
        '<div class="time-empty-title">' + title + '</div>' +
        '<div class="time-empty-text">' + text + '</div>' +
      '</div>';
  }

  // ---- Donut Chart (time per category) ----
  function renderDonutChart(container, categoryData, catColor, theme) {
    var size = 260;
    var outerRadius = size / 2 - 10;
    var innerRadius = outerRadius * 0.55;

    var svg = d3.select(container)
      .append('svg')
      .attr('width', size)
      .attr('height', size);

    var g = svg.append('g')
      .attr('transform', 'translate(' + (size / 2) + ',' + (size / 2) + ')');

    var pie = d3.pie()
      .value(function(d) { return d.actual; })
      .sort(null)
      .padAngle(0.03);

    var arc = d3.arc()
      .innerRadius(innerRadius)
      .outerRadius(outerRadius)
      .cornerRadius(4);

    var arcs = g.selectAll('path')
      .data(pie(categoryData))
      .enter()
      .append('path')
      .attr('fill', function(d, i) { return catColor(i); })
      .attr('fill-opacity', 0.85)
      .attr('stroke', theme.background)
      .attr('stroke-width', 2)
      .style('cursor', 'pointer');

    // Animate from zero
    arcs
      .attr('d', d3.arc().innerRadius(innerRadius).outerRadius(outerRadius).cornerRadius(4)
        .startAngle(function(d) { return d.startAngle; })
        .endAngle(function(d) { return d.startAngle; }) // collapsed
      )
      .transition()
      .delay(function(d, i) { return 200 + i * 100; })
      .duration(600)
      .ease(d3.easeQuadOut)
      .attrTween('d', function(d) {
        var interpolate = d3.interpolate(d.startAngle, d.endAngle);
        return function(t) {
          return d3.arc()
            .innerRadius(innerRadius)
            .outerRadius(outerRadius)
            .cornerRadius(4)
            .startAngle(d.startAngle)
            .endAngle(interpolate(t))();
        };
      });

    // Hover
    arcs
      .on('mouseover', function(event, d) {
        d3.select(this).transition().duration(150)
          .attr('fill-opacity', 1)
          .attr('transform', function() {
            var centroid = arc.centroid(d);
            var x = centroid[0] * 0.08;
            var y = centroid[1] * 0.08;
            return 'translate(' + x + ',' + y + ')';
          });
        var pct = Math.round(d.data.actual / d3.sum(categoryData, function(c) { return c.actual; }) * 100);
        tooltip.innerHTML =
          '<div class="graph-tooltip-title">' + d.data.name + '</div>' +
          '<div class="graph-tooltip-category">' + d.data.actual + ' min (' + pct + '%)</div>' +
          '<div class="graph-tooltip-connections">' + d.data.count + ' task' + (d.data.count !== 1 ? 's' : '') + '</div>';
        tooltip.style.opacity = '1';
        moveTooltip(event);
      })
      .on('mousemove', function(event) { moveTooltip(event); })
      .on('mouseout', function(event, d) {
        d3.select(this).transition().duration(200)
          .attr('fill-opacity', 0.85)
          .attr('transform', 'translate(0,0)');
        tooltip.style.opacity = '0';
      });

    // Center total
    var totalMin = d3.sum(categoryData, function(c) { return c.actual; });
    var centerG = g.append('g').style('pointer-events', 'none');

    centerG.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('dy', '-0.3em')
      .text(totalMin)
      .style('fill', theme.text)
      .style('font-size', '1.6rem')
      .style('font-weight', '700')
      .style('font-family', "'Inter', sans-serif")
      .attr('opacity', 0)
      .transition().delay(500).duration(400)
      .attr('opacity', 1);

    centerG.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('dy', '1.1em')
      .text('minutes')
      .style('fill', theme.textMuted)
      .style('font-size', '0.7rem')
      .style('text-transform', 'uppercase')
      .style('letter-spacing', '0.08em')
      .style('font-family', "'Inter', sans-serif")
      .attr('opacity', 0)
      .transition().delay(500).duration(400)
      .attr('opacity', 1);
  }

  // ---- Grouped Bar Chart (estimated vs actual per category) ----
  function renderComparisonChart(container, categoryData, catColor, theme) {
    var margin = { top: 10, right: 20, bottom: 50, left: 50 };
    var containerWidth = container.clientWidth || 340;
    var width = Math.min(containerWidth - margin.left - margin.right - 40, 360);
    var height = 230;

    var svg = d3.select(container)
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom);

    var g = svg.append('g')
      .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

    // X scale: categories
    var x0 = d3.scaleBand()
      .domain(categoryData.map(function(d) { return d.name; }))
      .range([0, width])
      .padding(0.35);

    // X1 scale: estimated vs actual within each category
    var x1 = d3.scaleBand()
      .domain(['estimated', 'actual'])
      .range([0, x0.bandwidth()])
      .padding(0.08);

    // Y scale
    var maxVal = d3.max(categoryData, function(d) { return Math.max(d.estimated, d.actual); }) || 25;
    var y = d3.scaleLinear()
      .domain([0, maxVal * 1.15])
      .range([height, 0]);

    // X axis
    g.append('g')
      .attr('class', 'time-axis')
      .attr('transform', 'translate(0,' + height + ')')
      .call(d3.axisBottom(x0).tickSize(0))
      .selectAll('text')
      .style('text-anchor', 'end')
      .attr('dx', '-0.5em')
      .attr('dy', '0.5em')
      .attr('transform', 'rotate(-25)')
      .text(function(d) { return d.length > 12 ? d.substring(0, 12) + '...' : d; });

    // Y axis
    g.append('g')
      .attr('class', 'time-axis')
      .call(d3.axisLeft(y).ticks(5).tickFormat(function(d) { return d + 'm'; }));

    // Bars
    var groups = g.selectAll('.time-bar-group')
      .data(categoryData)
      .enter()
      .append('g')
      .attr('transform', function(d) { return 'translate(' + x0(d.name) + ',0)'; });

    // Estimated bars (semi-transparent version of category color)
    groups.append('rect')
      .attr('class', 'time-bar')
      .attr('x', x1('estimated'))
      .attr('width', x1.bandwidth())
      .attr('y', height)
      .attr('height', 0)
      .attr('rx', 3)
      .attr('fill', function(d, i) { return catColor(i); })
      .attr('fill-opacity', 0.3)
      .attr('stroke', function(d, i) { return catColor(i); })
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,2')
      .on('mouseover', function(event, d) {
        tooltip.innerHTML =
          '<div class="graph-tooltip-title">' + d.name + '</div>' +
          '<div class="graph-tooltip-category">Estimated: ' + d.estimated + ' min</div>';
        tooltip.style.opacity = '1';
        moveTooltip(event);
      })
      .on('mousemove', function(event) { moveTooltip(event); })
      .on('mouseout', function() { tooltip.style.opacity = '0'; })
      .transition()
      .delay(function(d, i) { return 300 + i * 80; })
      .duration(500)
      .ease(d3.easeBackOut.overshoot(1))
      .attr('y', function(d) { return y(d.estimated); })
      .attr('height', function(d) { return height - y(d.estimated); });

    // Actual bars (solid category color)
    groups.append('rect')
      .attr('class', 'time-bar')
      .attr('x', x1('actual'))
      .attr('width', x1.bandwidth())
      .attr('y', height)
      .attr('height', 0)
      .attr('rx', 3)
      .attr('fill', function(d, i) { return catColor(i); })
      .attr('fill-opacity', 0.85)
      .on('mouseover', function(event, d) {
        var diff = d.actual - d.estimated;
        var sign = diff >= 0 ? '+' : '';
        tooltip.innerHTML =
          '<div class="graph-tooltip-title">' + d.name + '</div>' +
          '<div class="graph-tooltip-category">Actual: ' + d.actual + ' min</div>' +
          '<div class="graph-tooltip-connections">' + sign + diff + ' min vs estimate</div>';
        tooltip.style.opacity = '1';
        moveTooltip(event);
      })
      .on('mousemove', function(event) { moveTooltip(event); })
      .on('mouseout', function() { tooltip.style.opacity = '0'; })
      .transition()
      .delay(function(d, i) { return 400 + i * 80; })
      .duration(500)
      .ease(d3.easeBackOut.overshoot(1))
      .attr('y', function(d) { return y(d.actual); })
      .attr('height', function(d) { return height - y(d.actual); });

    // Bar chart legend (inline, below the chart)
    var legendG = svg.append('g')
      .attr('transform', 'translate(' + (margin.left + width / 2 - 80) + ',' + (height + margin.top + margin.bottom - 8) + ')');

    // Estimated legend
    legendG.append('rect')
      .attr('x', 0).attr('y', 0)
      .attr('width', 14).attr('height', 10)
      .attr('rx', 2)
      .attr('fill', theme.textMuted)
      .attr('fill-opacity', 0.3)
      .attr('stroke', theme.textMuted)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,2');
    legendG.append('text')
      .attr('x', 18).attr('y', 9)
      .text('Estimated')
      .style('fill', theme.textMuted)
      .style('font-size', '10px')
      .style('font-family', "'Inter', sans-serif");

    // Actual legend
    legendG.append('rect')
      .attr('x', 85).attr('y', 0)
      .attr('width', 14).attr('height', 10)
      .attr('rx', 2)
      .attr('fill', theme.textMuted)
      .attr('fill-opacity', 0.85);
    legendG.append('text')
      .attr('x', 103).attr('y', 9)
      .text('Actual')
      .style('fill', theme.textMuted)
      .style('font-size', '10px')
      .style('font-family', "'Inter', sans-serif");
  }

  // =========================================================================
  // Graph hover helpers
  // =========================================================================
  function onHover(node, linksData, nodes, links, labels, event, theme) {
    var adjacent = new Set([node.id]);
    linksData.forEach(function(link) {
      if (link.target.id === node.id || link.source.id === node.id) {
        adjacent.add(link.target.id);
        adjacent.add(link.source.id);
      }
    });

    nodes
      .transition().duration(200)
      .attr('opacity', function(d) { return adjacent.has(d.id) ? 1 : 0.15; })
      .attr('r', function(d) { return adjacent.has(d.id) && d.id === node.id ? nodesSize[d.id] * 1.3 : nodesSize[d.id]; });

    labels
      .transition().duration(200)
      .attr('opacity', function(d) { return adjacent.has(d.id) ? 1 : 0.1; })
      .attr('font-size', function(d) { return d.id === node.id ? '0.9rem' : '0.75rem'; });

    links
      .transition().duration(200)
      .attr('stroke', function(d) { return (d.source.id === node.id || d.target.id === node.id) ? theme.EDGE_HOVER_COLOR : theme.EDGE_DIM_COLOR; })
      .attr('stroke-width', function(d) { return (d.source.id === node.id || d.target.id === node.id) ? 2.5 : 1; });

    var tags = (node.tags && node.tags.length > 0) ? node.tags.map(function(t) { return '<span class="graph-tag">' + t + '</span>'; }).join(' ') : '';
    var categoryLabel = (node.category || 'note').charAt(0).toUpperCase() + (node.category || 'note').slice(1);
    tooltip.innerHTML =
      '<div class="graph-tooltip-title">' + node.label + '</div>' +
      '<div class="graph-tooltip-category">' + categoryLabel + '</div>' +
      (tags ? '<div class="graph-tooltip-tags">' + tags + '</div>' : '') +
      (node.number_neighbours > 0 ? '<div class="graph-tooltip-connections">' + node.number_neighbours + ' connection' + (node.number_neighbours !== 1 ? 's' : '') + '</div>' : '');
    tooltip.style.opacity = '1';
    moveTooltip(event);
  }

  function moveTooltip(event) {
    var x = event.clientX + 15;
    var y = event.clientY - 10;
    // Keep tooltip in viewport
    var tw = tooltip.offsetWidth || 200;
    var th = tooltip.offsetHeight || 100;
    if (x + tw > window.innerWidth - 10) x = event.clientX - tw - 15;
    if (y + th > window.innerHeight - 10) y = event.clientY - th - 10;
    if (y < 10) y = 10;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  }

  function onHoverEnd(nodes, links, labels, theme) {
    nodes.transition().duration(300)
      .attr('opacity', 1)
      .attr('r', function(d) { return nodesSize[d.id]; });
    labels.transition().duration(300)
      .attr('opacity', 1)
      .attr('font-size', '0.75rem');
    links.transition().duration(300)
      .attr('stroke', theme.EDGE_COLOR)
      .attr('stroke-width', 1.5);
    tooltip.style.opacity = '0';
  }

  // =========================================================================
  // Utilities
  // =========================================================================
  function isCurrentPath(notePath) {
    var current = window.location.pathname.replace(/\/$/, '');
    var target = notePath.replace(/\/$/, '');
    return current === target;
  }

  function computeNodeSize(node) {
    var weight = 8 * Math.sqrt(node.number_neighbours + 1);
    return Math.min(Math.max(weight, CONFIG.MIN_RADIUS), CONFIG.MAX_RADIUS);
  }

  function shorten(str, maxLen, separator) {
    separator = separator || ' ';
    if (str.length <= maxLen) return str;
    var shortened = str.substring(0, str.lastIndexOf(separator, maxLen));
    return (shortened || str.substring(0, maxLen)) + '...';
  }
})();

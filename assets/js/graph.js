{{ $graphData := resources.Get "js/graph-data.json" | resources.ExecuteAsTemplate "js/graph-data.json" . | resources.Minify | resources.Fingerprint }}

/**
  Digital Memory - Multi-View Knowledge Visualization
  Three view modes for exploring connected notes, books, and topics:
    1. Graph: D3 force-directed network
    2. Grid: Card-based browsable layout
    3. Radial: D3 sunburst hierarchy
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
  if (!graphWrapper) return;

  let currentNodeId = -1;
  let nodesSize = {};
  let tooltip = null;
  let cachedData = null;
  let currentView = localStorage.getItem('dm-view-mode') || 'graph';
  let graphRendered = false;
  let gridRendered = false;
  let radialRendered = false;

  init();

  // =========================================================================
  // Initialization
  // =========================================================================
  function init() {
    createTooltip();
    attachToggleListeners();

    fetch(CONFIG.GRAPH_DATA_URL)
      .then(res => res.json())
      .then(graphData => {
        cachedData = graphData;
        // Apply saved view
        switchView(currentView);
      })
      .catch(err => console.error('Graph data load error:', err));

    // Re-render active view when theme changes
    var observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        if (m.attributeName === 'data-theme' && cachedData) {
          setTimeout(function() {
            // Force re-render of current view
            graphRendered = false;
            gridRendered = false;
            radialRendered = false;
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

    renderCurrentView();
  }

  function renderCurrentView() {
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

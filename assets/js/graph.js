{{ $graphData := resources.Get "js/graph-data.json" | resources.ExecuteAsTemplate "js/graph-data.json" . | resources.Minify | resources.Fingerprint }}

/**
  Digital Memory - Knowledge Graph Visualization
  Force-directed graph showing connections between notes, books, and topics.
  Uses D3 v7 with category-based clustering, tooltips, and smooth animations.
  Supports light/dark theme switching via CSS custom properties.
*/
(function () {
  // Theme-aware color helper: reads CSS custom property values from :root
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
      BG_GRADIENT_END: dark ? '#2d3139' : '#eef1f5'
    };
  }

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

  const graphWrapper = document.getElementById('graph-wrapper');
  if (!graphWrapper) return;

  let currentNodeId = -1;
  let nodesSize = {};
  let tooltip = null;
  let cachedData = null;

  init();

  function init() {
    createTooltip();
    fetch(CONFIG.GRAPH_DATA_URL)
      .then(res => res.json())
      .then(graphData => {
        cachedData = graphData;
        initGraph(graphData.nodes, graphData.edges);
      })
      .catch(err => console.error('Graph data load error:', err));

    // Re-render graph when theme changes
    var observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        if (m.attributeName === 'data-theme' && cachedData) {
          // Small delay to let CSS variables update
          setTimeout(function() {
            currentNodeId = -1;
            nodesSize = {};
            initGraph(
              cachedData.nodes.map(function(n) { return Object.assign({}, n); }),
              cachedData.edges.map(function(e) { return { source: e.source.id || e.source, target: e.target.id || e.target, type: e.type }; })
            );
          }, 50);
        }
      });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  function createTooltip() {
    tooltip = document.createElement('div');
    tooltip.className = 'graph-tooltip';
    tooltip.style.cssText = 'position:absolute;pointer-events:none;opacity:0;transition:opacity 0.2s ease;';
    graphWrapper.appendChild(tooltip);
  }

  function initGraph(nodesData, linksData) {
    // Get current theme colors
    var theme = getThemeColors();

    function getCategoryColor(category) {
      return theme.CATEGORY_COLORS[category] || theme.CATEGORY_COLORS['default'];
    }

    // Clear any existing SVG
    graphWrapper.querySelectorAll('svg').forEach(el => el.remove());

    const width = graphWrapper.clientWidth;
    const height = graphWrapper.clientHeight;

    // Pre-cache
    nodesData.forEach(node => {
      if (isCurrentPath(node.path)) currentNodeId = node.id;
      nodesSize[node.id] = computeNodeSize(node);
    });

    const svg = d3.select(graphWrapper)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    // Defs for glow filters and gradients
    const defs = svg.append('defs');

    // Create glow filter for each category
    Object.entries(theme.CATEGORY_COLORS).forEach(([cat, colors]) => {
      const filter = defs.append('filter')
        .attr('id', `glow-${cat}`)
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

    // Active node glow
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

    // Draw links
    const links = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(linksData)
      .enter()
      .append('line')
      .attr('stroke', theme.EDGE_COLOR)
      .attr('stroke-width', d => d.type === 'backlink' ? 2 : 1.5)
      .attr('stroke-dasharray', d => d.type === 'tag' ? '6,4' : 'none');

    // Draw nodes
    const nodes = g.append('g')
      .attr('class', 'nodes')
      .selectAll('circle')
      .data(nodesData)
      .enter()
      .append('circle')
      .attr('r', d => nodesSize[d.id])
      .attr('fill', d => d.id === currentNodeId ? theme.ACTIVE_COLOR : getCategoryColor(d.category).node)
      .attr('filter', d => d.id === currentNodeId ? 'url(#glow-active)' : `url(#glow-${d.category || 'default'})`)
      .attr('stroke', d => d.id === currentNodeId ? theme.ACTIVE_COLOR : theme.NODE_STROKE)
      .attr('stroke-width', d => d.id === currentNodeId ? 2 : 1)
      .style('cursor', 'pointer');

    // Draw labels
    const labels = g.append('g')
      .attr('class', 'labels')
      .selectAll('text')
      .data(nodesData)
      .enter()
      .append('text')
      .text(d => shorten(d.label.replace(/_/g, ''), CONFIG.MAX_LABEL_LENGTH))
      .attr('fill', theme.LABEL_COLOR)
      .attr('text-anchor', 'middle')
      .attr('font-size', '0.75rem')
      .attr('font-weight', d => d.id === currentNodeId ? '600' : '400')
      .attr('dy', d => -(nodesSize[d.id] + 8))
      .style('cursor', 'pointer')
      .style('text-shadow', theme.LABEL_SHADOW);

    // Simulation
    const simulation = d3.forceSimulation(nodesData)
      .force('charge', d3.forceManyBody().strength(CONFIG.CHARGE_STRENGTH))
      .force('link', d3.forceLink(linksData).id(d => d.id).distance(CONFIG.LINK_DISTANCE))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('x', d3.forceX(width / 2).strength(0.1))
      .force('y', d3.forceY(height / 2).strength(0.1))
      .force('collision', d3.forceCollide().radius(CONFIG.COLLISION_RADIUS))
      .stop();

    // Pre-run simulation
    d3.range(CONFIG.TICKS).forEach(simulation.tick);

    // Position elements (start hidden for animation)
    nodes.attr('cx', d => d.x).attr('cy', d => d.y)
      .attr('opacity', 0).attr('r', 0);
    labels.attr('x', d => d.x).attr('y', d => d.y)
      .attr('opacity', 0);
    links
      .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y)
      .attr('opacity', 0);

    // Animated entrance — nodes scale in with staggered delay
    nodes.transition()
      .delay((d, i) => i * 80)
      .duration(600)
      .ease(d3.easeBackOut.overshoot(1.2))
      .attr('opacity', 1)
      .attr('r', d => nodesSize[d.id]);

    // Labels fade in after nodes
    labels.transition()
      .delay((d, i) => i * 80 + 300)
      .duration(400)
      .ease(d3.easeQuadOut)
      .attr('opacity', 1);

    // Links fade in after both connected nodes have appeared
    const nodeCount = nodesData.length;
    links.transition()
      .delay(() => nodeCount * 80 + 200)
      .duration(500)
      .ease(d3.easeQuadOut)
      .attr('opacity', 1);

    // Interactions
    nodes
      .on('click', (event, d) => { window.location = d.path; })
      .on('mouseover', (event, d) => onHover(d, linksData, nodes, links, labels, event, theme))
      .on('mousemove', (event) => moveTooltip(event))
      .on('mouseout', () => onHoverEnd(nodes, links, labels, theme));

    labels
      .on('click', (event, d) => { window.location = d.path; })
      .on('mouseover', (event, d) => onHover(d, linksData, nodes, links, labels, event, theme))
      .on('mousemove', (event) => moveTooltip(event))
      .on('mouseout', () => onHoverEnd(nodes, links, labels, theme));

    // Zoom
    const zoom = d3.zoom()
      .scaleExtent(CONFIG.ZOOM_RANGE)
      .on('zoom', event => g.attr('transform', event.transform));

    svg.call(zoom);

    // Auto-fit zoom: calculate bounding box of nodes and scale to fill container
    const padding = 80;
    const xExtent = d3.extent(nodesData, d => d.x);
    const yExtent = d3.extent(nodesData, d => d.y);
    const graphWidth = (xExtent[1] - xExtent[0]) || 1;
    const graphHeight = (yExtent[1] - yExtent[0]) || 1;
    const graphCenterX = (xExtent[0] + xExtent[1]) / 2;
    const graphCenterY = (yExtent[0] + yExtent[1]) / 2;

    // Scale to fit nodes within container, capped to avoid over-zooming with few nodes
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
    const resizeObserver = new ResizeObserver(() => {
      const newW = graphWrapper.clientWidth;
      const newH = graphWrapper.clientHeight;
      svg.attr('width', newW).attr('height', newH);
    });
    resizeObserver.observe(graphWrapper);
  }

  function onHover(node, linksData, nodes, links, labels, event, theme) {
    const adjacent = new Set([node.id]);
    linksData.forEach(link => {
      if (link.target.id === node.id || link.source.id === node.id) {
        adjacent.add(link.target.id);
        adjacent.add(link.source.id);
      }
    });

    nodes
      .transition().duration(200)
      .attr('opacity', d => adjacent.has(d.id) ? 1 : 0.15)
      .attr('r', d => adjacent.has(d.id) && d.id === node.id ? nodesSize[d.id] * 1.3 : nodesSize[d.id]);

    labels
      .transition().duration(200)
      .attr('opacity', d => adjacent.has(d.id) ? 1 : 0.1)
      .attr('font-size', d => d.id === node.id ? '0.9rem' : '0.75rem');

    links
      .transition().duration(200)
      .attr('stroke', d => (d.source.id === node.id || d.target.id === node.id) ? theme.EDGE_HOVER_COLOR : theme.EDGE_DIM_COLOR)
      .attr('stroke-width', d => (d.source.id === node.id || d.target.id === node.id) ? 2.5 : 1);

    // Show tooltip
    const tags = (node.tags && node.tags.length > 0) ? node.tags.map(t => `<span class="graph-tag">${t}</span>`).join(' ') : '';
    const categoryLabel = (node.category || 'note').charAt(0).toUpperCase() + (node.category || 'note').slice(1);
    tooltip.innerHTML = `
      <div class="graph-tooltip-title">${node.label}</div>
      <div class="graph-tooltip-category">${categoryLabel}</div>
      ${tags ? `<div class="graph-tooltip-tags">${tags}</div>` : ''}
      ${node.number_neighbours > 0 ? `<div class="graph-tooltip-connections">${node.number_neighbours} connection${node.number_neighbours !== 1 ? 's' : ''}</div>` : ''}
    `;
    tooltip.style.opacity = '1';
    moveTooltip(event);
  }

  function moveTooltip(event) {
    const rect = graphWrapper.getBoundingClientRect();
    const x = event.clientX - rect.left + 15;
    const y = event.clientY - rect.top - 10;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  }

  function onHoverEnd(nodes, links, labels, theme) {
    nodes.transition().duration(300)
      .attr('opacity', 1)
      .attr('r', d => nodesSize[d.id]);
    labels.transition().duration(300)
      .attr('opacity', 1)
      .attr('font-size', '0.75rem');
    links.transition().duration(300)
      .attr('stroke', theme.EDGE_COLOR)
      .attr('stroke-width', 1.5);
    tooltip.style.opacity = '0';
  }

  function isCurrentPath(notePath) {
    const current = window.location.pathname.replace(/\/$/, '');
    const target = notePath.replace(/\/$/, '');
    return current === target;
  }

  function computeNodeSize(node) {
    const weight = 8 * Math.sqrt(node.number_neighbours + 1);
    return Math.min(Math.max(weight, CONFIG.MIN_RADIUS), CONFIG.MAX_RADIUS);
  }

  function shorten(str, maxLen, separator = ' ') {
    if (str.length <= maxLen) return str;
    const shortened = str.substring(0, str.lastIndexOf(separator, maxLen));
    return (shortened || str.substring(0, maxLen)) + '...';
  }
})();

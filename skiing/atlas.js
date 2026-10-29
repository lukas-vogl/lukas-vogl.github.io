(() => {
  'use strict';
  const data = window.SKI_ATLAS;
  const errorBox = document.querySelector('.map-error');
  if (!data || !window.L) {
    errorBox.hidden = false;
    errorBox.querySelector('span').textContent = 'The map could not start. Reload the page to try again.';
    document.querySelector('#retry-map').onclick = () => window.location.reload();
    return;
  }
  const L = window.L;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const status = document.querySelector('.map-status');
  const summary = document.querySelector('.tour-summary');
  const choices = document.querySelector('.tour-choices');
  choices.replaceChildren(...data.tours.map((tour, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'tour-choice'; button.dataset.tour = tour.id;
    button.setAttribute('aria-pressed', 'false');
    const number = document.createElement('span'); number.className = 'tour-number'; number.textContent = String(index + 1).padStart(2, '0');
    const name = document.createElement('span'); name.className = 'tour-name'; name.textContent = tour.name;
    const region = document.createElement('small'); region.textContent = tour.region; name.append(region);
    const count = document.createElement('span'); count.className = 'tour-count'; count.textContent = data.media.filter(item => item.tour === tour.id).length;
    const arrow = document.createElement('span'); arrow.className = 'tour-arrow'; arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '↗';
    button.append(number, name, count, arrow);
    return button;
  }));
  document.querySelector('.tour-total').textContent = String(data.tours.length).padStart(2, '0');
  document.querySelector('.overview-button').textContent = '↖ All ' + data.tours.length + ' tours';
  const tourButtons = [...document.querySelectorAll('[data-tour]')];
  const viewer = document.querySelector('.media-viewer');
  const viewerPhoto = document.querySelector('.viewer-photo');
  const viewerVideo = document.querySelector('.viewer-video');
  const about = document.querySelector('.about-dialog');
  const byTour = id => data.tours.find(tour => tour.id === id);
  const byMedia = id => data.media.find(item => item.id === id);
  const tourMedia = id => data.media.filter(item => item.tour === id);
  const thumb = item => 'skiing/thumbs/' + item.id + '.webp';
  const mobile = () => window.innerWidth <= 700;
  const zoomStep = 1.5;
  const tourZoom = 12;
  const mediaZoom = 12.5;
  let selectedTour = null;
  let activeMedia = null;
  let opener = null;
  let cardEntries = [];
  let fitting = false;
  let zooming = false;
  let layoutFrame = 0;
  let resizeTimer = 0;

  const map = L.map('map', {
    zoomControl: false, attributionControl: false,
    minZoom: 7, maxZoom: 16, zoomSnap: .25, zoomDelta: zoomStep,
    maxBounds: [[45.55, 5.65], [48.15, 10.85]], maxBoundsViscosity: .8,
    zoomAnimation: !reducedMotion, fadeAnimation: !reducedMotion,
    // Cards are laid out again at the new scale; hiding them during a zoom
    // prevents their fixed-size frames from sweeping over location dots.
    markerZoomAnimation: false, inertia: !reducedMotion,
    scrollWheelZoom: true, wheelPxPerZoomLevel: 16, wheelDebounceTime: 16,
    keyboard: true, tap: true
  }).setView([46.48, 8.65], 8);
  let previousZoom = map.getZoom();
  const tiles = L.tileLayer(data.tileUrl, {
    minZoom: 7, maxZoom: 16, maxNativeZoom: 18,
    noWrap: true, keepBuffer: 2, crossOrigin: true, zIndex: 2
  }).addTo(map);
  L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 100 }).addTo(map);
  const groundLayer = L.layerGroup().addTo(map);
  const cardLayer = L.layerGroup().addTo(map);
  let loadedTiles = 0, failedTiles = 0;
  tiles.on('loading', () => { loadedTiles = 0; failedTiles = 0; });
  tiles.on('tileload', () => { loadedTiles++; errorBox.hidden = true; });
  tiles.on('tileerror', () => { failedTiles++; });
  tiles.on('load', () => { errorBox.hidden = !(failedTiles && !loadedTiles); });
  document.querySelector('#retry-map').addEventListener('click', () => { errorBox.hidden = true; tiles.redraw(); });
  window.addEventListener('offline', () => { errorBox.hidden = false; });
  window.addEventListener('online', () => { errorBox.hidden = true; tiles.redraw(); });

  function fitPadding() {
    const short = window.innerHeight < 600;
    return {
      paddingTopLeft: mobile() ? [26, short ? 145 : 168] : [330, 100],
      paddingBottomRight: mobile() ? [64, selectedTour ? (short ? 125 : 190) : 75] : [90, selectedTour ? 190 : 75]
    };
  }
  function fitView() {
    fitting = true;
    const bounds = selectedTour
      ? L.latLngBounds(tourMedia(selectedTour).map(item => item.position)).pad(.25)
      : L.latLngBounds(data.tours.map(tour => tour.position)).pad(.08);
    map.fitBounds(bounds, { ...fitPadding(), maxZoom: selectedTour ? 14 : 10, animate: false });
    fitting = false;
    scheduleLayout();
    updateZoomButtons();
  }
  function updateZoomButtons() {
    document.querySelector('#zoom-in').disabled = map.getZoom() >= map.getMaxZoom();
    document.querySelector('#zoom-out').disabled = map.getZoom() <= map.getMinZoom();
  }
  function writeLocation(mediaId = null) {
    const params = new URLSearchParams();
    if (selectedTour) params.set('tour', selectedTour);
    if (mediaId) params.set('media', mediaId);
    const hash = params.toString();
    history.replaceState(null, '', window.location.pathname + window.location.search + (hash ? '#' + hash : ''));
  }
  function accessibleMarker(marker, label) {
    marker.on('add', () => {
      const element = marker.getElement();
      element.setAttribute('aria-label', label);
      element.setAttribute('title', label);
      element.addEventListener('keydown', event => {
        if (event.key === ' ') { event.preventDefault(); marker.fire('click'); }
      });
    });
    return marker;
  }
  function createCard(item, isTour) {
    const element = document.createElement('div');
    element.className = isTour ? 'tour-map-card' : 'media-map-card';
    const cover = isTour ? data.media.find(media => media.src === item.cover) || tourMedia(item.id)[0] : item;
    const image = document.createElement('img');
    image.src = thumb(cover); image.alt = ''; image.draggable = false;
    image.width = 360; image.height = 300;
    element.append(image);
    const caption = document.createElement('div');
    caption.className = isTour ? 'tour-map-caption' : 'media-map-caption';
    if (isTour) {
      const title = document.createElement('strong'); title.textContent = item.name;
      const count = document.createElement('small'); count.textContent = tourMedia(item.id).length + ' moments';
      caption.append(title, count);
    } else {
      caption.textContent = item.title;
      if (item.type === 'video') {
        const film = document.createElement('span'); film.className = 'media-type'; film.textContent = '▶';
        film.setAttribute('aria-hidden', 'true'); element.append(film);
      }
    }
    element.append(caption);
    return element;
  }
  function renderCards() {
    groundLayer.clearLayers(); cardLayer.clearLayers(); cardEntries = [];
    const isTour = !selectedTour;
    const items = isTour ? data.tours : tourMedia(selectedTour);
    const size = cardSize(items.length, isTour);
    items.forEach(item => {
      const label = isTour ? `Explore ${item.name}. ${tourMedia(item.id).length} photographs and films.` :
        `Open ${item.title}. ${item.type === 'video' ? 'Film' : 'Photograph'}. ${byTour(item.tour).name}.`;
      const marker = accessibleMarker(L.marker(item.position, {
        icon: L.divIcon({ html: createCard(item, isTour), className: isTour ? 'tour-map-marker' : 'media-map-marker', iconSize: size, iconAnchor: [size[0] / 2, size[1] / 2] }),
        keyboard: true, riseOnHover: true, autoPanOnFocus: true
      }), label);
      marker.on('click', () => isTour ? selectTour(item.id) : openMedia(item.id, marker.getElement()));
      marker.addTo(cardLayer);
      const markerElement = marker.getElement();
      markerElement.dataset[isTour ? 'mapTour' : 'mapMedia'] = item.id;
      markerElement.style.setProperty('--card-width', size[0] + 'px');
      markerElement.style.setProperty('--card-height', size[1] + 'px');
      markerElement.classList.toggle('compact-card', size[0] < 115);
      const dot = L.circleMarker(item.position, {
        radius: isTour ? 4 : 3.5, color: '#8f422b', weight: 1.5,
        fillColor: '#8f422b', fillOpacity: 1, interactive: false
      }).addTo(groundLayer);
      const line = L.polyline([item.position, item.position], {
        color: '#554e3c', weight: 1, opacity: .7, interactive: false
      }).addTo(groundLayer);
      cardEntries.push({ item, marker, dot, line, width: size[0], height: size[1] });
    });
    cardEntries.forEach(({ dot }) => dot.bringToFront());
    updateMediaSelection();
    scheduleLayout();
  }
  function overlapArea(a, b) {
    return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
      Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  }
  function cardViewport() {
    const size = map.getSize(), pad = fitPadding();
    const left = pad.paddingTopLeft[0] + 4;
    const right = Math.max(left + 100, size.x - (mobile() ? 64 : 90));
    const top = pad.paddingTopLeft[1] - 10;
    const bottom = Math.max(top + 100, size.y - (selectedTour ? (mobile() ? (size.y < 600 ? 125 : 170) : 175) : 62));
    return { left, right, top, bottom, gap: mobile() ? 7 : 12 };
  }
  // Leave a little room for the ground dots when the collection fills the map.
  function cardSize(count, isTour) {
    const diameter = isTour ? (mobile() ? 108 : 144) : (mobile() ? 80 : 104);
    const base = [diameter, diameter];
    const { left, right, top, bottom, gap } = cardViewport();
    let scale = 0;
    for (let columns = 1; columns <= Math.max(count, 1); columns++) {
      const rows = Math.ceil(count / columns);
      scale = Math.max(scale, Math.min(1, (right - left - (columns - 1) * gap) / columns / base[0],
        (bottom - top - (rows - 1) * gap) / rows / base[1]));
    }
    if (scale < 1) scale *= .92;
    return base.map(value => Math.max(1, Math.floor(value * scale)));
  }
  function splitFreeRects(rectangles, obstacle) {
    const result = [];
    rectangles.forEach(rect => {
      if (!overlapArea(rect, obstacle)) { result.push(rect); return; }
      if (obstacle.left > rect.left) result.push({ ...rect, right: obstacle.left });
      if (obstacle.right < rect.right) result.push({ ...rect, left: obstacle.right });
      if (obstacle.top > rect.top) result.push({ ...rect, bottom: obstacle.top });
      if (obstacle.bottom < rect.bottom) result.push({ ...rect, top: obstacle.bottom });
    });
    return result.filter((rect, index) => !result.some((other, otherIndex) => otherIndex !== index &&
      other.left <= rect.left && other.right >= rect.right && other.top <= rect.top && other.bottom >= rect.bottom &&
      (otherIndex < index || other.left < rect.left || other.right > rect.right || other.top < rect.top || other.bottom > rect.bottom)));
  }
  function packCards(entries, width, height, bounds, dots, budget = 550) {
    // The 20px exclusion keeps every dot clear, including the hover lift and
    // selected-card outline. Bounds already reserve space for the map controls.
    const lift = 4, clearance = 20;
    let free = (bounds.regions || [bounds]).map(({ left, right, top, bottom }) => ({ left, right, top, bottom }));
    dots.forEach(point => {
      free = splitFreeRects(free, { left: point.x - clearance, right: point.x + clearance,
        top: point.y - clearance, bottom: point.y + clearance });
    });
    const packedHeight = height + lift;
    if (!free.some(rect => rect.right - rect.left >= width && rect.bottom - rect.top >= packedHeight)) return null;
    let attempts = 0;
    function place(index, rectangles, placements) {
      if (index === entries.length) return placements;
      if (++attempts > budget) return null;
      const point = entries[index].point, candidates = [], seen = new Set();
      rectangles.forEach(rect => {
        if (rect.right - rect.left < width || rect.bottom - rect.top < packedHeight) return;
        const nearX = Math.max(rect.left, Math.min(rect.right - width, point.x - width / 2));
        const nearY = Math.max(rect.top, Math.min(rect.bottom - packedHeight, point.y - packedHeight / 2));
        [[nearX, nearY], [rect.left, rect.top], [rect.right - width, rect.top],
          [rect.left, rect.bottom - packedHeight], [rect.right - width, rect.bottom - packedHeight]].forEach(([x, y]) => {
          const key = x.toFixed(2) + ',' + y.toFixed(2);
          if (seen.has(key)) return;
          seen.add(key);
          const distance = Math.hypot(x + width / 2 - point.x, y + packedHeight / 2 - point.y);
          const unusedSide = Math.min(rect.right - rect.left - width, rect.bottom - rect.top - packedHeight);
          candidates.push({ x, y, score: distance + unusedSide * .16 });
        });
      });
      candidates.sort((a, b) => a.score - b.score);
      for (const candidate of candidates.slice(0, 32)) {
        const obstacle = { left: candidate.x - bounds.gap, right: candidate.x + width + bounds.gap,
          top: candidate.y - bounds.gap, bottom: candidate.y + packedHeight + bounds.gap };
        const next = splitFreeRects(rectangles, obstacle).filter(rect =>
          rect.right - rect.left >= width && rect.bottom - rect.top >= packedHeight);
        if (index < entries.length - 1 && !next.length) continue;
        const result = place(index + 1, next, placements.concat({ x: candidate.x + width / 2, y: candidate.y + lift + height / 2 }));
        if (result) return result;
      }
      return null;
    }
    return place(0, free, []);
  }
  // Card positions are packed separately from their geographic anchors. Neither a
  // crowded collection nor the small-screen fallback may cover any ground dot.
  function layoutCards() {
    layoutFrame = 0;
    if (!map._loaded || !cardEntries.length) return;
    const size = map.getSize(), bounds = cardViewport();
    const entries = cardEntries.map(entry => ({ ...entry, point: map.latLngToContainerPoint(entry.item.position) }));
    const dots = entries.map(entry => entry.point).filter(point => point.x >= 0 && point.x <= size.x && point.y >= 0 && point.y <= size.y);
    const visible = entries.filter(entry => {
      const { point, marker, line } = entry;
      const offscreen = point.x < -100 || point.x > size.x + 100 || point.y < -100 || point.y > size.y + 100;
      marker.getElement().hidden = offscreen;
      line.setStyle({ opacity: offscreen ? 0 : .7 });
      return !offscreen;
    }).sort((a, b) => a.point.y - b.point.y || a.point.x - b.point.x);
    if (!visible.length) return;
    const desired = cardSize(visible.length, !selectedTour);
    const minimum = selectedTour ? [64, 64] : [72, 72];
    let positions = null, width = desired[0], height = desired[1], packingBounds = bounds;
    const testedSizes = new Set();
    const trySize = (nextWidth, nextHeight, area = bounds, budget = 550) => {
      width = height = Math.min(nextWidth, nextHeight);
      positions = packCards(visible, width, height, area, dots, budget);
      return Boolean(positions);
    };
    // Resize the circular portraits uniformly so their hit areas and image
    // crops stay square, including on short landscape screens.
    for (let scale = 1; scale >= .25 && !positions; scale *= .92) {
      const nextWidth = Math.max(minimum[0], Math.floor(desired[0] * scale));
      const nextHeight = Math.max(minimum[1], Math.floor(desired[1] * scale));
      const key = nextWidth + ',' + nextHeight;
      if (testedSizes.has(key)) break;
      testedSizes.add(key);
      if (trySize(nextWidth, nextHeight)) break;
    }
    if (!positions) {
      // Use the spare map space above the controls before trying the compact
      // 60px floor. This also handles dots shifted toward an edge while panning.
      const toolsBox = document.querySelector('.map-tools').getBoundingClientRect();
      const toolsTop = toolsBox.height ? toolsBox.top : size.y - (mobile() ? 174 : 182);
      const expanded = { ...bounds, left: mobile() ? 16 : bounds.left, right: size.x - (mobile() ? 60 : 90) };
      expanded.regions = [{ ...expanded }, { left: expanded.left, right: size.x - 18,
        top: bounds.top, bottom: Math.min(bounds.bottom, toolsTop - 12) }].filter(rect => rect.bottom > rect.top);
      packingBounds = expanded;
      if (!trySize(minimum[0], minimum[1], expanded, 1800)) trySize(60, 60, expanded, 1800);
    }
    if (!positions) {
      // On windows too small to fit the readable cards, keep the largest legal
      // subset. Every moment remains available through the tour's Browse action.
      width = 60; height = 60;
      let count = visible.length - 1;
      while (count > 0 && !positions) {
        positions = packCards(visible.slice(0, count), width, height, packingBounds, dots, 1800);
        if (!positions) count--;
      }
      visible.splice(count).forEach(({ marker, line }) => {
        marker.getElement().hidden = true;
        line.setStyle({ opacity: 0 });
      });
      if (!positions) return;
    }
    visible.forEach((entry, index) => {
      const { marker, line, point } = entry;
      const element = marker.getElement(), icon = marker.options.icon;
      icon.options.iconSize = [width, height]; icon.options.iconAnchor = [width / 2, height / 2];
      element.style.width = width + 'px'; element.style.height = height + 'px';
      element.style.marginLeft = -width / 2 + 'px'; element.style.marginTop = -height / 2 + 'px';
      element.style.setProperty('--card-width', width + 'px'); element.style.setProperty('--card-height', height + 'px');
      element.classList.toggle('compact-card', width < 115);
      const { x, y } = positions[index];
      marker.setLatLng(map.containerPointToLatLng([x, y]));
      const dx = point.x - x, dy = point.y - y;
      const distance = Math.hypot(dx, dy);
      const ratio = distance ? Math.min(1, width / (2 * distance)) : 0;
      const edge = [x + dx * ratio, y + dy * ratio];
      line.setLatLngs([entry.item.position, map.containerPointToLatLng(edge)]);
    });
  }
  function scheduleLayout() {
    if (!layoutFrame) layoutFrame = requestAnimationFrame(() => {
      layoutCards();
      if (!zooming) map.getContainer().classList.remove('is-zooming');
    });
  }
  function selectTour(id, options = {}) {
    if (id && !byTour(id)) return;
    selectedTour = id;
    document.body.classList.toggle('has-tour', Boolean(id));
    tourButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tour === id)));
    if (id && mobile()) {
      const button = tourButtons.find(button => button.dataset.tour === id);
      choices.scrollLeft = button.offsetLeft - (choices.clientWidth - button.offsetWidth) / 2;
    }
    document.querySelector('.overview-button').disabled = !id;
    document.querySelector('#fit-tour').setAttribute('aria-label', id ? 'Fit this tour in the map' : 'Fit all tours in the map');
    summary.hidden = !id;
    if (id) {
      const tour = byTour(id);
      document.querySelector('#selected-tour-name').textContent = tour.name;
      document.querySelector('#selected-tour-region').textContent = tour.region + ' / ' + tourMedia(id).length + ' moments';
      document.querySelector('#selected-tour-description').textContent = tour.description;
      status.textContent = tour.name + '. ' + tourMedia(id).length + ' photographs and films on the map.';
    } else status.textContent = data.tours.length + ' tour areas and ' + data.media.length + ' photographs and films. Choose a tour to zoom in.';
    renderCards();
    if (options.fit !== false) fitView();
    if (options.history !== false) writeLocation();
  }

  function stopVideo() {
    viewerVideo.pause();
    viewerVideo.removeAttribute('src');
    viewerVideo.removeAttribute('poster');
    viewerVideo.load();
  }
  function updateMediaSelection() {
    cardEntries.forEach(({ item, marker }) => {
      if (item.type) marker.getElement().setAttribute('aria-pressed', String(item.id === activeMedia?.id));
    });
  }
  function displayMedia(id) {
    const item = byMedia(id);
    if (!item) return;
    activeMedia = item;
    updateMediaSelection();
    stopVideo();
    viewerPhoto.hidden = item.type !== 'photo';
    viewerVideo.hidden = item.type !== 'video';
    if (item.type === 'photo') { viewerPhoto.src = item.src; viewerPhoto.alt = item.alt; }
    else { viewerVideo.src = item.src; viewerVideo.poster = item.poster; viewerVideo.setAttribute('aria-label', item.alt); }
    document.querySelector('#viewer-tour').textContent = byTour(item.tour).name + ' / ' + (item.type === 'video' ? 'Moving picture' : 'Photograph');
    document.querySelector('#viewer-title').textContent = item.title;
    document.querySelector('#viewer-location').textContent = byTour(item.tour).region;
    document.querySelector('.viewer-note').textContent = item.alt;
    document.querySelector('.viewer-original').href = item.source || item.src;
    const collection = tourMedia(item.tour);
    document.querySelector('.viewer-count').textContent = String(collection.indexOf(item) + 1).padStart(2, '0') + ' / ' + String(collection.length).padStart(2, '0');
  }
  function openMedia(id, trigger = null, updateHistory = true) {
    const item = byMedia(id);
    if (!item) return;
    if (typeof viewer.showModal !== 'function') { window.location.href = item.src; return; }
    if (selectedTour !== item.tour) selectTour(item.tour, { history: false });
    opener = trigger || document.activeElement;
    displayMedia(id);
    if (!viewer.open) viewer.showModal();
    if (updateHistory) writeLocation(id);
  }
  function stepMedia(direction) {
    if (!activeMedia) return;
    const collection = tourMedia(activeMedia.tour);
    const index = (collection.indexOf(activeMedia) + direction + collection.length) % collection.length;
    displayMedia(collection[index].id);
    writeLocation(collection[index].id);
  }
  function restoreLocation() {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const tourId = params.get('tour');
    const item = byMedia(params.get('media'));
    selectTour(byTour(tourId) ? tourId : item ? item.tour : null, { history: false });
    if (item && item.tour === selectedTour) openMedia(item.id, null, false);
    else if (viewer.open) viewer.close();
  }

  tourButtons.forEach(button => button.addEventListener('click', () => selectTour(button.dataset.tour)));
  document.querySelector('.overview-button').addEventListener('click', () => selectTour(null));
  document.querySelector('#fit-tour').addEventListener('click', fitView);
  document.querySelector('#zoom-in').addEventListener('click', () => map.zoomIn(zoomStep, { animate: !reducedMotion }));
  document.querySelector('#zoom-out').addEventListener('click', () => map.zoomOut(zoomStep, { animate: !reducedMotion }));
  document.querySelector('.browse-tour').addEventListener('click', event => {
    if (selectedTour) openMedia(tourMedia(selectedTour)[0].id, event.currentTarget);
  });
  document.querySelector('.viewer-close').addEventListener('click', () => viewer.close());
  document.querySelector('.viewer-prev').addEventListener('click', () => stepMedia(-1));
  document.querySelector('.viewer-next').addEventListener('click', () => stepMedia(1));
  // The enlarged media floats above the map. Only an intentional click on the
  // surrounding map/transparent space dismisses it, not a drag off video controls.
  let outsidePress = false;
  const outsideMedia = target => !target.closest('.viewer-header, .viewer-footer, .viewer-photo, .viewer-video');
  viewer.addEventListener('pointerdown', event => { outsidePress = outsideMedia(event.target); });
  viewer.addEventListener('pointercancel', () => { outsidePress = false; });
  viewer.addEventListener('click', event => {
    if (outsidePress && outsideMedia(event.target)) viewer.close();
    outsidePress = false;
  });
  viewer.addEventListener('keydown', event => {
    if (event.target.closest('video')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); stepMedia(event.key === 'ArrowRight' ? 1 : -1);
    }
  });
  viewer.addEventListener('close', () => {
    outsidePress = false;
    stopVideo();
    activeMedia = null;
    updateMediaSelection();
    writeLocation();
    const fallback = document.querySelector('[data-tour="' + selectedTour + '"]');
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    else if (fallback) fallback.focus({ preventScroll: true });
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) viewerVideo.pause(); });
  document.querySelector('.about-button').addEventListener('click', () => {
    if (typeof about.showModal === 'function') about.showModal();
    else window.location.href = 'https://map.geo.admin.ch/#/map?layers=ch.swisstopo.zeitreihen@year=1930';
  });
  document.querySelector('.about-close').addEventListener('click', () => about.close());
  map.on('zoomstart', () => {
    zooming = true;
    map.getContainer().classList.add('is-zooming');
  });
  map.on('moveend', scheduleLayout);
  map.on('zoomend', () => {
    zooming = false;
    updateZoomButtons();
    const zoom = map.getZoom();
    const zoomingOut = zoom < previousZoom;
    const zoomingIn = zoom > previousZoom;
    previousZoom = zoom;
    if (!fitting && !viewer.open) {
      if (selectedTour && zoomingOut && zoom <= tourZoom) selectTour(null, { fit: false });
      else if (!selectedTour && zoomingIn && zoom >= mediaZoom) {
        // A tour can span several valleys; zooming into any of its media should
        // open it even when the overview pin lies outside the current view.
        const candidates = data.tours.filter(tour => [tour.position, ...tourMedia(tour.id).map(item => item.position)]
          .some(position => map.getBounds().contains(position)));
        const distance = tour => Math.min(...tourMedia(tour.id).map(item => map.getCenter().distanceTo(item.position)), map.getCenter().distanceTo(tour.position));
        candidates.sort((a, b) => distance(a) - distance(b));
        if (candidates[0]) selectTour(candidates[0].id, { fit: false });
      }
    }
    scheduleLayout();
  });
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { map.invalidateSize({ pan: false }); renderCards(); fitView(); }, 120);
  });
  window.addEventListener('hashchange', restoreLocation);
  restoreLocation();
})();

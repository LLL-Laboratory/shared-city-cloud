(() => {
  "use strict";

  const data = window.SCC_DATA;
  const app = document.querySelector("#cloudApp");
  const canvas = document.querySelector("#cloudCanvas");
  const labelsLayer = document.querySelector("#spatialLabels");
  const guideLabelsLayer = document.querySelector("#worldGuideLabels");
  const liveRegion = document.querySelector("#liveRegion");
  const orientationTitle = document.querySelector("#orientationTitle");
  const orientationHint = document.querySelector("#orientationHint");
  const detailLayer = document.querySelector("#detailLayer");
  const timelineLayer = document.querySelector("#timeline");
  const pathLayer = document.querySelector("#pathReplay");
  const guideLayer = document.querySelector("#guidedHandover");
  const navigator = document.querySelector("#navigator");
  const pulseMessage = document.querySelector("#cityPulseMessage");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!data?.nodes?.length) {
    app.innerHTML =
      '<p class="noscript">The local record snapshot is missing. Run <code>npm.cmd run data:refresh</code>, then reload.</p>';
    return;
  }

  const nodeById = new Map(data.nodes.map((node) => [node.id, node]));
  const state = {
    selected: null,
    hovered: null,
    timelineStage: 4,
    pathIndex: 0,
    guideIndex: 0,
    routeNodes: new Set(),
    focusNodes: new Set(),
    pulseStartedAt: null,
    pulseTargets: new Set(),
    pointer: null,
    projected: new Map(),
    camera: {
      yaw: -0.12,
      pitch: 0.22,
      distance: 16.4,
      target: [0, 0.15, -0.35],
      targetGoal: [0, 0.15, -0.35]
    }
  };

  const labelElements = new Map();
  const guideLabelElements = new Map();
  const timeLabelElements = new Map();

  function announce(message) {
    liveRegion.textContent = "";
    window.setTimeout(() => {
      liveRegion.textContent = message;
    }, 20);
  }

  function makeElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function closeLayer(name) {
    const layers = {
      timeline: timelineLayer,
      path: pathLayer,
      guide: guideLayer,
      navigator
    };
    const element = layers[name];
    if (!element) return;
    element.hidden = true;
    if (name === "timeline") {
      document.querySelector("#timelineButton").setAttribute("aria-expanded", "false");
    }
    if (name === "guide") {
      document.querySelector("#handoverButton").setAttribute("aria-expanded", "false");
    }
    if (name === "navigator") {
      document.querySelector("#navigatorButton").setAttribute("aria-expanded", "false");
    }
    if (name === "path" || name === "guide") {
      state.routeNodes.clear();
      refreshRouteClasses();
    }
  }

  function closeDetail() {
    detailLayer.hidden = true;
    state.selected = null;
    state.focusNodes.clear();
    app.classList.remove("is-focused");
    state.camera.targetGoal = [0, 0.15, -0.35];
    orientationTitle.textContent = "SECTION 01 / LAGOS";
    orientationHint.textContent = "ground records Â· active work Â· equal lens canopy";
    refreshRouteClasses();
  }

  function addBadge(container, text, labelClass = "") {
    const badge = makeElement("span", `badge ${labelClass}`.trim(), text);
    container.append(badge);
  }

  function addDetailAction(label, handler, primary = false) {
    const button = makeElement("button", "", label);
    button.type = "button";
    if (primary) button.dataset.primary = "true";
    button.addEventListener("click", handler);
    document.querySelector("#detailActions").append(button);
  }

  function renderDetail(nodeId) {
    const node = nodeById.get(nodeId);
    if (!node) return;

    state.selected = node.id;
    state.focusNodes = new Set([node.id, "foundation"]);
    for (const edge of data.edges) {
      if (edge.from === node.id) state.focusNodes.add(edge.to);
      if (edge.to === node.id) state.focusNodes.add(edge.from);
    }
    app.classList.add("is-focused");
    detailLayer.hidden = false;
    document.querySelector("#detailBreadcrumb").textContent =
      `World / ${node.region ?? node.kind} / ${node.title}`;
    document.querySelector("#detailKind").textContent = node.kind;
    document.querySelector("#detailTitle").textContent = node.title;
    document.querySelector("#detailSummary").textContent = node.short;

    const badges = document.querySelector("#detailBadges");
    badges.replaceChildren();
    addBadge(badges, node.label, "badge--label");
    addBadge(badges, node.status);
    addBadge(badges, `Effect: ${node.effect}`);

    const facts = document.querySelector("#detailFacts");
    facts.replaceChildren();
    const factEntries = [
      ["World region", node.region ?? node.kind],
      ["Layer", node.kind],
      ["Timeline", data.timeline[node.stage]?.display ?? "Illustrative"],
      ["Shared memory", node.effect],
      ["Current answer", node.currentAnswer ?? node.status]
    ];
    for (const [term, description] of factEntries) {
      const wrapper = document.createElement("div");
      wrapper.append(makeElement("dt", "", term), makeElement("dd", "", description));
      facts.append(wrapper);
    }

    const notes = document.querySelector("#detailNotes");
    notes.replaceChildren(
      ...(node.details ?? []).map((note) => makeElement("p", "detail-note", note))
    );

    const sources = document.querySelector("#detailSources");
    sources.replaceChildren(
      ...(node.sourceRefs ?? []).map((source) => makeElement("li", "", source))
    );

    const relationships = document.querySelector("#detailRelationships");
    const linkedEdges = data.edges.filter((edge) => edge.from === node.id || edge.to === node.id);
    relationships.replaceChildren(
      ...(linkedEdges.length
        ? linkedEdges.map((edge) => {
            const otherId = edge.from === node.id ? edge.to : edge.from;
            const other = nodeById.get(otherId);
            const item = document.createElement("li");
            item.append(
              makeElement("strong", "", edge.relationshipType ?? edge.kind),
              makeElement("span", "", `${edge.label} â†’ ${other?.title ?? otherId}`)
            );
            return item;
          })
        : [makeElement("li", "", "No explicit relationship is encoded for this object.")])
    );

    const actions = document.querySelector("#detailActions");
    actions.replaceChildren();
    if (node.id === "condition") {
      addDetailAction("Send City Pulse", startCityPulse, true);
      addDetailAction("Replay governance path", openPathReplay);
    } else if (node.id === "review") {
      addDetailAction("Replay governance path", openPathReplay, true);
    } else if (node.id === "handoff") {
      addDetailAction("Start guided handover", openGuidedHandover, true);
    } else if (node.id === "thoughts") {
      addDetailAction("Browse unresolved items", () => openNavigator("What Needs Thought?"), true);
    }
    addDetailAction("Return to whole cloud", closeDetail);

    state.camera.targetGoal = [
      node.position[0] * 0.22,
      node.position[1] * 0.22,
      node.position[2] * 0.16
    ];
    orientationTitle.textContent = node.title;
    orientationHint.textContent = `${node.label} Â· ${node.status}`;
    announce(`${node.title} selected. ${node.label}. ${node.status}.`);
    refreshRouteClasses();
  }

  document.querySelector(".detail-layer__close").addEventListener("click", closeDetail);
  document.querySelector("#detailBackToWorld").addEventListener("click", closeDetail);

  function updateTimelineReadout() {
    const item = data.timeline[state.timelineStage];
    document.querySelector("#timelineDisplay").textContent = item.display;
    const accuracy = document.querySelector("#timelineAccuracy");
    accuracy.textContent = item.accuracy;
    accuracy.style.color = item.stage === 4 ? "var(--illustrative)" : "var(--known)";
    document.querySelector("#timelineNote").textContent = item.note;
    announce(`${item.display}. ${item.accuracy}. ${item.note}`);
  }

  function toggleTimeline(forceOpen) {
    const shouldOpen = forceOpen ?? timelineLayer.hidden;
    timelineLayer.hidden = !shouldOpen;
    document.querySelector("#timelineButton").setAttribute("aria-expanded", String(shouldOpen));
    if (shouldOpen) {
      updateTimelineReadout();
      document.querySelector("#timelineRange").focus();
    }
  }

  document.querySelector("#timelineButton").addEventListener("click", () => toggleTimeline());
  document.querySelector("#timelineRange").addEventListener("input", (event) => {
    state.timelineStage = Number(event.currentTarget.value);
    updateTimelineReadout();
    if (state.selected && nodeById.get(state.selected).stage > state.timelineStage) {
      closeDetail();
    }
  });

  function averageNodePosition(nodeIds) {
    const positions = nodeIds.map((id) => nodeById.get(id)?.position).filter(Boolean);
    if (!positions.length) return [0, 0.15, -0.35];
    return positions
      .reduce((sum, position) => sum.map((value, index) => value + position[index]), [0, 0, 0])
      .map((value) => value / positions.length);
  }

  function updatePathReplay() {
    const step = data.pathReplay[state.pathIndex];
    state.routeNodes = new Set(step.nodeIds);
    const position = averageNodePosition(step.nodeIds);
    state.camera.targetGoal = position.map((value) => value * 0.26);
    document.querySelector("#pathCount").textContent =
      `${state.pathIndex + 1} / ${data.pathReplay.length}`;
    document.querySelector("#pathPrevious").disabled = state.pathIndex === 0;
    document.querySelector("#pathNext").disabled =
      state.pathIndex === data.pathReplay.length - 1;

    const steps = document.querySelector("#pathSteps");
    steps.replaceChildren(
      ...data.pathReplay.map((item, index) => {
        const element = makeElement(
          "span",
          `route-step${index < state.pathIndex ? " is-past" : ""}${index === state.pathIndex ? " is-active" : ""}`
        );
        element.title = `${item.date}: ${item.state}`;
        return element;
      })
    );

    document.querySelector(".route-caveat").textContent =
      `${step.date} Â· ${step.label} Â· ${step.state}. ${step.note} Current record status remains DRAFT / FOR TEAM REVIEW; shared-memory effect NONE.`;
    orientationTitle.textContent = step.state;
    orientationHint.textContent = `${step.date} Â· ${step.label}`;
    announce(`Path Replay step ${state.pathIndex + 1}. ${step.state}. ${step.note}`);
    refreshRouteClasses();
  }

  function openPathReplay() {
    closeLayer("guide");
    pathLayer.hidden = false;
    state.pathIndex = 0;
    updatePathReplay();
    document.querySelector("#pathNext").focus();
  }

  document.querySelector("#pathPrevious").addEventListener("click", () => {
    state.pathIndex = Math.max(0, state.pathIndex - 1);
    updatePathReplay();
  });
  document.querySelector("#pathNext").addEventListener("click", () => {
    state.pathIndex = Math.min(data.pathReplay.length - 1, state.pathIndex + 1);
    updatePathReplay();
  });

  function updateGuidedHandover() {
    const step = data.guidedHandover[state.guideIndex];
    state.routeNodes = new Set(step.nodeIds);
    const position = averageNodePosition(step.nodeIds);
    state.camera.targetGoal = position.map((value) => value * 0.24);
    document.querySelector("#guideStepTitle").textContent = step.title;
    document.querySelector("#guideStepBody").textContent = step.body;
    document.querySelector("#guideCount").textContent =
      `${state.guideIndex + 1} / ${data.guidedHandover.length}`;
    document.querySelector("#guidePrevious").disabled = state.guideIndex === 0;
    document.querySelector("#guideNext").disabled =
      state.guideIndex === data.guidedHandover.length - 1;
    orientationTitle.textContent = step.title;
    orientationHint.textContent = step.body;
    announce(`Guided handover step ${state.guideIndex + 1}. ${step.title}. ${step.body}`);
    refreshRouteClasses();
  }

  function openGuidedHandover() {
    closeLayer("path");
    guideLayer.hidden = false;
    document.querySelector("#handoverButton").setAttribute("aria-expanded", "true");
    state.guideIndex = 0;
    updateGuidedHandover();
    document.querySelector("#guideNext").focus();
  }

  document.querySelector("#handoverButton").addEventListener("click", () => {
    if (guideLayer.hidden) openGuidedHandover();
    else closeLayer("guide");
  });
  document.querySelector("#guidePrevious").addEventListener("click", () => {
    state.guideIndex = Math.max(0, state.guideIndex - 1);
    updateGuidedHandover();
  });
  document.querySelector("#guideNext").addEventListener("click", () => {
    state.guideIndex = Math.min(data.guidedHandover.length - 1, state.guideIndex + 1);
    updateGuidedHandover();
  });

  const navigatorRegionOrder = [
    "City Foundation",
    "Active Work Horizon",
    "Food Territory",
    "Money Territory",
    "Sand Territory",
    "Source / Detail Fragments",
    "Methods & Handoffs",
    "What Needs Thought?"
  ];

  function buildNavigator() {
    const root = document.querySelector("#navigatorGroups");
    root.replaceChildren();
    for (const title of navigatorRegionOrder) {
      const matchingNodes = data.nodes.filter((node) => node.region === title);
      if (!matchingNodes.length) continue;
      const group = makeElement("section", "navigator-group");
      group.dataset.group = title;
      group.append(makeElement("h3", "", title));
      const grid = makeElement("div", "navigator-grid");
      for (const node of matchingNodes) {
        const card = makeElement("button", "navigator-card");
        card.type = "button";
        card.dataset.nodeId = node.id;
        card.dataset.hierarchy = String(node.hierarchy ?? 3);
        card.append(
          makeElement("small", "", `${node.label} Â· ${node.status}`),
          makeElement("strong", "", node.title),
          makeElement("span", "", node.short)
        );
        card.addEventListener("click", () => {
          closeLayer("navigator");
          renderDetail(node.id);
        });
        grid.append(card);
      }
      group.append(grid);
      root.append(group);
    }
  }

  function openNavigator(groupTitle) {
    navigator.hidden = false;
    document.querySelector("#navigatorButton").setAttribute("aria-expanded", "true");
    const targetGroup = groupTitle
      ? navigator.querySelector(`[data-group="${groupTitle}"] .navigator-card`)
      : navigator.querySelector(".navigator-card");
    (targetGroup ?? navigator.querySelector("[data-close='navigator']")).focus();
    announce("Non-3D research object navigator opened.");
  }

  buildNavigator();
  document.querySelector("#navigatorButton").addEventListener("click", () => {
    if (navigator.hidden) openNavigator();
    else closeLayer("navigator");
  });

  document.querySelectorAll("[data-close]").forEach((button) => {
    const layerName = button.getAttribute("data-close");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeLayer(layerName);
    });
  });

  function refreshRouteClasses() {
    for (const [nodeId, element] of labelElements) {
      element.classList.toggle("is-selected", state.selected === nodeId);
      element.classList.toggle("is-route", state.routeNodes.has(nodeId));
      element.classList.toggle(
        "is-dimmed",
        Boolean(state.selected) && !state.focusNodes.has(nodeId)
      );
    }
    document.querySelectorAll(".navigator-card").forEach((card) => {
      card.classList.toggle("is-route", state.routeNodes.has(card.dataset.nodeId));
    });
  }

  function startCityPulse() {
    const now = performance.now();
    state.pulseStartedAt = now;
    state.pulseTargets = new Set(["condition"]);
    for (const edge of data.edges.filter((item) => item.pulseEligible)) {
      state.pulseTargets.add(edge.from);
      state.pulseTargets.add(edge.to);
    }
    pulseMessage.hidden = false;
    announce(
      "City Pulse travelled through the supported condition, research contract, equal lens structure, and claim review. Unknown impacts remained quiet."
    );
    window.setTimeout(() => {
      pulseMessage.hidden = true;
    }, 4200);
  }

  function resetView() {
    state.camera.yaw = -0.12;
    state.camera.pitch = 0.22;
    state.camera.distance = 16.4;
    state.camera.target = [0, 0.15, -0.35];
    state.camera.targetGoal = [0, 0.15, -0.35];
    closeDetail();
    closeLayer("path");
    closeLayer("guide");
    announce("Whole cloud view restored.");
  }

  document.querySelector("#resetView").addEventListener("click", resetView);

  window.addEventListener("keydown", (event) => {
    if (event.target.matches("input, textarea, select")) return;
    if (event.key === "Escape") {
      if (!navigator.hidden) closeLayer("navigator");
      else if (!pathLayer.hidden) closeLayer("path");
      else if (!guideLayer.hidden) closeLayer("guide");
      else if (!timelineLayer.hidden) closeLayer("timeline");
      else if (!detailLayer.hidden) closeDetail();
      return;
    }
    if (event.key.toLowerCase() === "n") openNavigator();
    if (event.key.toLowerCase() === "t") toggleTimeline();
    if (event.key.toLowerCase() === "h") openGuidedHandover();
    if (document.activeElement === canvas) {
      if (event.key === "ArrowLeft") state.camera.yaw -= 0.08;
      if (event.key === "ArrowRight") state.camera.yaw += 0.08;
      if (event.key === "ArrowUp") state.camera.pitch = Math.min(0.62, state.camera.pitch + 0.06);
      if (event.key === "ArrowDown") state.camera.pitch = Math.max(-0.5, state.camera.pitch - 0.06);
    }
  });

  for (const node of data.nodes) {
    const button = makeElement("button", "cloud-label");
    button.type = "button";
    button.dataset.nodeId = node.id;
    button.dataset.hierarchy = String(node.hierarchy ?? 3);
    button.tabIndex = -1;
    button.setAttribute("aria-label", `Select ${node.title}, ${node.label}`);
    button.append(makeElement("span", "", node.title), makeElement("small", "", node.label));
    button.addEventListener("click", () => renderDetail(node.id));
    labelsLayer.append(button);
    labelElements.set(node.id, button);
  }

  for (const guide of data.guides ?? []) {
    if (!guide.showLabel) continue;
    const label = makeElement("div", "world-guide-label", guide.title);
    label.dataset.kind = guide.kind;
    guideLabelsLayer.append(label);
    guideLabelElements.set(guide.id, label);
  }

  for (const marker of data.timeMarkers ?? []) {
    const label = makeElement("div", "time-field-label", marker.label);
    label.dataset.stage = String(marker.stage);
    guideLabelsLayer.append(label);
    timeLabelElements.set(marker.stage, label);
  }

  canvas.tabIndex = 0;
  canvas.setAttribute(
    "aria-describedby",
    "orientationHint"
  );

  const gl = canvas.getContext("webgl", {
    antialias: true,
    alpha: true,
    premultipliedAlpha: false,
    powerPreference: "high-performance"
  });

  if (!gl) {
    canvas.hidden = true;
    labelsLayer.hidden = true;
    guideLabelsLayer.hidden = true;
    orientationTitle.textContent = "3D unavailable";
    orientationHint.textContent = "The complete non-3D Navigator remains available.";
    openNavigator();
    announce("WebGL is unavailable. The non-3D Navigator opened automatically.");
    return;
  }

  function compileShader(type, sourceText) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, sourceText);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function createProgram(vertexSource, fragmentSource) {
    const program = gl.createPr…3353 tokens truncated… curvature = 0, strandOffset = 0) {
    const vertices = [];
    const delta = subtract(to, from);
    const distance = Math.hypot(...delta);
    const perpendicular = normalize([-delta[2], 0, delta[0]]);
    const arc = Math.min(1.65, distance * 0.18) + curvature;
    const controlA = [
      from[0] + delta[0] * 0.28 + perpendicular[0] * strandOffset,
      from[1] + delta[1] * 0.24 + arc * 0.22,
      from[2] + delta[2] * 0.2 + perpendicular[2] * strandOffset + arc * 0.42
    ];
    const controlB = [
      from[0] + delta[0] * 0.72 + perpendicular[0] * strandOffset,
      from[1] + delta[1] * 0.76 - arc * 0.08,
      from[2] + delta[2] * 0.8 + perpendicular[2] * strandOffset + arc * 0.42
    ];
    const point = (amount) => {
      const inverse = 1 - amount;
      return [
        inverse ** 3 * from[0] +
          3 * inverse * inverse * amount * controlA[0] +
          3 * inverse * amount * amount * controlB[0] +
          amount ** 3 * to[0],
        inverse ** 3 * from[1] +
          3 * inverse * inverse * amount * controlA[1] +
          3 * inverse * amount * amount * controlB[1] +
          amount ** 3 * to[1],
        inverse ** 3 * from[2] +
          3 * inverse * inverse * amount * controlA[2] +
          3 * inverse * amount * amount * controlB[2] +
          amount ** 3 * to[2]
      ];
    };
    const segments = 44;
    for (let index = 0; index < segments; index += 1) {
      if (dashed && [2, 3].includes(index % 6)) continue;
      vertices.push(...point(index / segments), ...point((index + 1) / segments));
    }
    return vertices;
  }

  function ellipseVertices(center, radii, dashed = false) {
    const vertices = [];
    const segments = 72;
    for (let index = 0; index < segments; index += 1) {
      if (dashed && index % 3 === 1) continue;
      const point = (amount) => [
        center[0] + Math.cos(amount * Math.PI * 2) * radii[0],
        center[1] + Math.sin(amount * Math.PI * 2) * radii[1],
        center[2]
      ];
      vertices.push(...point(index / segments), ...point((index + 1) / segments));
    }
    return vertices;
  }

  function drawGuideVertices(viewProjection, vertices, color, alpha) {
    if (!vertices.length) return;
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(lineLocations.position, 3, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(lineLocations.viewProjection, false, viewProjection);
    gl.uniform3fv(lineLocations.color, color);
    gl.uniform1f(lineLocations.alpha, alpha);
    gl.drawArrays(gl.LINES, 0, vertices.length / 3);
  }

  function renderGuides(viewProjection, positions) {
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(lineProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
    gl.enableVertexAttribArray(lineLocations.position);

    for (const guide of data.guides ?? []) {
      if (guide.kind === "ground") {
        const vertices = [];
        for (let x = -guide.extentX; x <= guide.extentX + 0.001; x += guide.step) {
          vertices.push(x, guide.y, -guide.extentZ, x, guide.y, guide.extentZ);
        }
        for (let z = -guide.extentZ; z <= guide.extentZ + 0.001; z += guide.step) {
          vertices.push(-guide.extentX, guide.y, z, guide.extentX, guide.y, z);
        }
        drawGuideVertices(viewProjection, vertices, guide.color, guide.alpha);
        continue;
      }

      if (guide.kind === "route") {
        for (let index = 0; index < guide.nodeIds.length - 1; index += 1) {
          const from = positions.get(guide.nodeIds[index]);
          const to = positions.get(guide.nodeIds[index + 1]);
          drawGuideVertices(
            viewProjection,
            curveVertices(from, to, false, 0.08),
            guide.color,
            guide.alpha
          );
        }
        continue;
      }

      if (guide.kind === "datum") {
        drawGuideVertices(
          viewProjection,
          [...guide.from, ...guide.to],
          guide.color,
          guide.alpha
        );
        continue;
      }

      if (guide.kind === "canopy") {
        for (let index = 0; index < guide.nodeIds.length - 1; index += 1) {
          drawGuideVertices(
            viewProjection,
            curveVertices(
              positions.get(guide.nodeIds[index]),
              positions.get(guide.nodeIds[index + 1]),
              false,
              -0.25
            ),
            guide.color,
            guide.alpha
          );
        }
      }
    }

    const timeVertices = [];
    const markers = data.timeMarkers ?? [];
    if (markers.length) {
      timeVertices.push(
        markers[0].position[0] - 0.35,
        markers[0].position[1],
        markers[0].position[2],
        markers.at(-1).position[0] + 0.35,
        markers.at(-1).position[1],
        markers.at(-1).position[2]
      );
      for (const marker of markers) {
        timeVertices.push(
          marker.position[0],
          marker.position[1] - 0.02,
          marker.position[2],
          marker.position[0],
          marker.position[1] + 0.18,
          marker.position[2]
        );
      }
      drawGuideVertices(viewProjection, timeVertices, [0.55, 0.55, 0.52], 0.18);
    }
    gl.depthMask(true);
  }

  function renderParticles(viewProjection, pixelRatio) {
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(particleProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, particleBuffer);
    gl.enableVertexAttribArray(particleLocations.position);
    gl.vertexAttribPointer(particleLocations.position, 3, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(particleLocations.viewProjection, false, viewProjection);
    gl.uniform1f(particleLocations.pixelRatio, pixelRatio);
    gl.drawArrays(gl.POINTS, 0, particles.length / 3);
  }

  function pulseStrength(time, edgeIndex) {
    if (state.pulseStartedAt === null) return 0;
    const elapsed = (time - state.pulseStartedAt) / 1000;
    if (elapsed > 3.4) {
      state.pulseStartedAt = null;
      state.pulseTargets.clear();
      return 0;
    }
    const center = edgeIndex * 0.12 + 0.3;
    return Math.max(0, 1 - Math.abs(elapsed - center) * 3.2);
  }

  function edgeColor(edge) {
    if (edge.kind === "unresolved") return [0.39, 0.4, 0.4];
    if (edge.kind === "active-route") return [0.48, 0.58, 0.61];
    if (edge.kind === "equal-standing") return [0.59, 0.59, 0.56];
    if (edge.kind === "record" || edge.kind === "provenance") return [0.64, 0.63, 0.58];
    if (edge.kind === "separate-response") return [0.53, 0.55, 0.53];
    return [0.46, 0.49, 0.49];
  }

  function edgeStrands(edge) {
    if (edge.kind === "active-route") return 3;
    if (edge.kind === "separate-response") return 3;
    if (edge.kind === "provenance") return 3;
    if (edge.kind === "method" || edge.kind === "record") return 2;
    return 1;
  }

  function renderEdges(viewProjection, positions, time) {
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(lineProgram);
    gl.enableVertexAttribArray(lineLocations.position);
    gl.uniformMatrix4fv(lineLocations.viewProjection, false, viewProjection);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);

    data.edges.forEach((edge, edgeIndex) => {
      const fromNode = nodeById.get(edge.from);
      const toNode = nodeById.get(edge.to);
      if (
        !fromNode ||
        !toNode ||
        fromNode.stage > state.timelineStage ||
        toNode.stage > state.timelineStage
      ) {
        return;
      }
      const pulse = edge.pulseEligible ? pulseStrength(time, edgeIndex) : 0;
      const route = state.routeNodes.has(edge.from) && state.routeNodes.has(edge.to);
      const focusEdge =
        !state.selected ||
        edge.from === state.selected ||
        edge.to === state.selected ||
        route;
      const color = edgeColor(edge);
      gl.uniform3fv(lineLocations.color, pulse > 0 ? [0.68, 0.34, 0.24] : color);
      const baseAlpha =
        pulse > 0
          ? 0.72
          : route
            ? 0.54
            : edge.kind === "active-route"
              ? 0.65
              : edge.quiet
                ? 0.3
                : edge.kind === "equal-standing"
                  ? 0.44
                  : edge.kind === "record" || edge.kind === "provenance"
                    ? 0.75
                    : edge.kind === "separate-response"
                      ? 0.7
                      : 0.48;
      const strands = edgeStrands(edge);
      for (let strand = 0; strand < strands; strand += 1) {
        const offset = (strand - (strands - 1) / 2) * 0.055;
        const vertices = curveVertices(
          positions.get(edge.from),
          positions.get(edge.to),
          edge.dashed,
          (edgeIndex % 5) * 0.045,
          offset
        );
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(lineLocations.position, 3, gl.FLOAT, false, 0, 0);
        gl.uniform1f(
          lineLocations.alpha,
          (baseAlpha / Math.max(1, strands * 0.72)) * (focusEdge ? 1 : 0.32)
        );
        gl.drawArrays(gl.LINES, 0, vertices.length / 3);
      }
    });
    gl.depthMask(true);
  }

  function renderNode(node, position, viewProjection, cameraPosition, time) {
    const mesh = meshes[node.shape] ?? meshes.sphere;
    const isSelected = state.selected === node.id;
    const isHovered = state.hovered === node.id;
    const isRoute = state.routeNodes.has(node.id);
    const pulseActive =
      state.pulseStartedAt !== null &&
      state.pulseTargets.has(node.id) &&
      !node.quietDuringPulse;
    const pulseWave = pulseActive
      ? Math.max(0, Math.sin((time - state.pulseStartedAt) * 0.008))
      : 0;
    const future = node.stage > state.timelineStage;
    const dimmed = Boolean(state.selected) && !state.focusNodes.has(node.id);
    const emphasis = isSelected || isRoute ? 1 : isHovered ? 0.68 : pulseWave * 0.92;
    const scale = node.size * (1 + emphasis * 0.12);
    const scaleVector = (node.scale ?? [1, 1, 1]).map((value) => value * scale);
    const rotation = node.stable ? 0 : time * 0.00011 + node.position[0] * 0.16;
    const world = multiplyMatrices(
      translationMatrix(position),
      multiplyMatrices(
        rotationYMatrix(rotation),
        multiplyMatrices(
          rotationXMatrix(node.shape === "ring" ? Math.PI / 2.7 : 0),
          scaleMatrix(scaleVector)
        )
      )
    );

    gl.useProgram(meshProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.positionBuffer);
    gl.enableVertexAttribArray(meshLocations.position);
    gl.vertexAttribPointer(meshLocations.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normalBuffer);
    gl.enableVertexAttribArray(meshLocations.normal);
    gl.vertexAttribPointer(meshLocations.normal, 3, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(meshLocations.world, false, world);
    gl.uniformMatrix4fv(meshLocations.viewProjection, false, viewProjection);
    gl.uniform3fv(meshLocations.color, node.color);
    gl.uniform3fv(meshLocations.camera, cameraPosition);
    gl.uniform1f(meshLocations.emphasis, emphasis);
    gl.uniform1f(meshLocations.fragment, node.fragment ? 1 : 0);
    const baseAlpha = future
      ? 0.045
      : node.fragment
        ? 0.94
        : node.thought
          ? 0.48
          : node.material === "lens"
            ? 0.72
            : node.id === "foundation"
              ? 0.42
              : node.kind === "IMMUTABLE LENS RECORD"
                ? 0.76
                : 0.88;
    gl.uniform1f(meshLocations.alpha, dimmed ? Math.min(baseAlpha, 0.3) : baseAlpha);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }

  function shouldShowLabel(node) {
    if (node.stage > state.timelineStage) return false;
    if (node.primary) return true;
    if (state.selected === node.id || state.hovered === node.id || state.routeNodes.has(node.id)) {
      return true;
    }
    if (node.thought && state.selected === "thoughts") return true;
    if (node.kind === "IMMUTABLE LENS RECORD") {
      return state.selected === `lens-${node.id.replace("record-", "")}`;
    }
    return false;
  }

  function updateLabels(viewProjection, positions) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    state.projected.clear();
    for (const node of data.nodes) {
      const clip = transformPoint(viewProjection, positions.get(node.id));
      const element = labelElements.get(node.id);
      if (clip[3] <= 0.01) {
        element.classList.remove("is-visible");
        continue;
      }
      const normalizedX = clip[0] / clip[3];
      const normalizedY = clip[1] / clip[3];
      const x = (normalizedX * 0.5 + 0.5) * width;
      const y = (-normalizedY * 0.5 + 0.5) * height;
      const onScreen = normalizedX > -1.25 && normalizedX < 1.25 && normalizedY > -1.2 && normalizedY < 1.2;
      const visible = onScreen && shouldShowLabel(node);
      element.style.left = `${x}px`;
      const labelTop = node.fragment
        ? y + 28
        : node.kind === "LENS"
          ? y + 24
          : node.id === "condition"
            ? y + 25
            : y - node.size * 26 - 16;
      element.style.top = `${labelTop}px`;
      element.classList.toggle("is-visible", visible);
      state.projected.set(node.id, {
        x,
        y,
        radius: Math.max(20, node.size * 42),
        depth: clip[3],
        active: node.stage <= state.timelineStage
      });
    }
    refreshRouteClasses();
  }

  function updateGuideLabels(viewProjection) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    for (const guide of data.guides ?? []) {
      const element = guideLabelElements.get(guide.id);
      const clip = transformPoint(viewProjection, guide.labelPosition);
      if (!element || clip[3] <= 0.01) {
        element?.classList.remove("is-visible");
        continue;
      }
      const normalizedX = clip[0] / clip[3];
      const normalizedY = clip[1] / clip[3];
      const onScreen =
        normalizedX > -1.18 &&
        normalizedX < 1.18 &&
        normalizedY > -1.1 &&
        normalizedY < 1.1;
      element.style.left = `${(normalizedX * 0.5 + 0.5) * width}px`;
      element.style.top = `${(-normalizedY * 0.5 + 0.5) * height}px`;
      element.classList.toggle("is-visible", onScreen);
    }
  }

  function updateTimeLabels(viewProjection) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    for (const marker of data.timeMarkers ?? []) {
      const element = timeLabelElements.get(marker.stage);
      const clip = transformPoint(viewProjection, marker.position);
      if (!element || clip[3] <= 0.01) {
        element?.classList.remove("is-visible");
        continue;
      }
      const normalizedX = clip[0] / clip[3];
      const normalizedY = clip[1] / clip[3];
      const onScreen =
        normalizedX > -1.12 &&
        normalizedX < 1.12 &&
        normalizedY > -1.05 &&
        normalizedY < 1.05;
      element.style.left = `${(normalizedX * 0.5 + 0.5) * width}px`;
      element.style.top = `${(-normalizedY * 0.5 + 0.5) * height + 14}px`;
      element.classList.toggle(
        "is-visible",
        onScreen && marker.stage <= state.timelineStage
      );
      element.classList.toggle("is-illustrative", !marker.known);
    }
  }

  function resizeCanvas() {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio));
    const height = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    return pixelRatio;
  }

  function cameraPosition() {
    const camera = state.camera;
    const horizontal = Math.cos(camera.pitch) * camera.distance;
    return [
      camera.target[0] + Math.sin(camera.yaw) * horizontal,
      camera.target[1] + Math.sin(camera.pitch) * camera.distance,
      camera.target[2] + Math.cos(camera.yaw) * horizontal
    ];
  }

  function render(time) {
    const pixelRatio = resizeCanvas();
    for (let index = 0; index < 3; index += 1) {
      state.camera.target[index] +=
        (state.camera.targetGoal[index] - state.camera.target[index]) * (reducedMotion ? 1 : 0.055);
    }

    const eye = cameraPosition();
    const projection = perspectiveMatrix(
      Math.PI / 4.1,
      canvas.clientWidth / Math.max(1, canvas.clientHeight),
      0.1,
      80
    );
    const view = lookAtMatrix(eye, state.camera.target);
    const viewProjection = multiplyMatrices(projection, view);
    const positions = new Map(
      data.nodes.map((node) => [node.id, nodeFloatPosition(node, time)])
    );

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    renderParticles(viewProjection, pixelRatio);
    renderGuides(viewProjection, positions);
    renderEdges(viewProjection, positions, time);
    for (const node of data.nodes) {
      renderNode(node, positions.get(node.id), viewProjection, eye, time);
    }
    updateLabels(viewProjection, positions);
    updateGuideLabels(viewProjection);
    updateTimeLabels(viewProjection);
    window.requestAnimationFrame(render);
  }

  function pickNode(clientX, clientY) {
    const rectangle = canvas.getBoundingClientRect();
    const x = clientX - rectangle.left;
    const y = clientY - rectangle.top;
    let winner = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const [nodeId, projected] of state.projected) {
      if (!projected.active) continue;
      const distance = Math.hypot(projected.x - x, projected.y - y);
      if (distance <= projected.radius) {
        const score = distance + projected.depth * 0.15;
        if (score < bestScore) {
          bestScore = score;
          winner = nodeId;
        }
      }
    }
    return winner;
  }

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    state.pointer = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      previousX: event.clientX,
      previousY: event.clientY,
      moved: false
    };
    canvas.classList.add("is-dragging");
  });

  canvas.addEventListener("pointermove", (event) => {
    if (state.pointer?.id === event.pointerId) {
      const deltaX = event.clientX - state.pointer.previousX;
      const deltaY = event.clientY - state.pointer.previousY;
      if (Math.hypot(event.clientX - state.pointer.startX, event.clientY - state.pointer.startY) > 5) {
        state.pointer.moved = true;
      }
      if (state.pointer.moved) {
        state.camera.yaw -= deltaX * 0.006;
        state.camera.pitch = Math.max(-0.52, Math.min(0.66, state.camera.pitch + deltaY * 0.005));
      }
      state.pointer.previousX = event.clientX;
      state.pointer.previousY = event.clientY;
      return;
    }
    state.hovered = pickNode(event.clientX, event.clientY);
  });

  function finishPointer(event) {
    if (!state.pointer || state.pointer.id !== event.pointerId) return;
    if (!state.pointer.moved) {
      const picked = pickNode(event.clientX, event.clientY);
      if (picked) renderDetail(picked);
    }
    state.pointer = null;
    canvas.classList.remove("is-dragging");
  }

  canvas.addEventListener("pointerup", finishPointer);
  canvas.addEventListener("pointercancel", finishPointer);
  canvas.addEventListener("pointerleave", () => {
    if (!state.pointer) state.hovered = null;
  });
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      state.camera.distance = Math.max(8.2, Math.min(22, state.camera.distance + event.deltaY * 0.009));
    },
    { passive: false }
  );

  updateTimelineReadout();
  window.requestAnimationFrame(render);
})();


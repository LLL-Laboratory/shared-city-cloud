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
  const conflictComparison = document.querySelector("#conflictComparison");
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
    evidenceVisible: false,
    conflictPathwayId: null,
    returnFocus: null,
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

  function closeConflictComparison({ restoreRoute = true } = {}) {
    conflictComparison.hidden = true;
    detailLayer.classList.remove("detail-layer--conflict");
    state.conflictPathwayId = null;
    if (restoreRoute) {
      state.routeNodes.clear();
      state.evidenceVisible =
        state.selected === "condition" || Boolean(nodeById.get(state.selected)?.evidenceSource);
      state.focusNodes = new Set(["foundation"]);
      if (state.selected) {
        state.focusNodes.add(state.selected);
        for (const edge of data.edges) {
          if (edge.from === state.selected) state.focusNodes.add(edge.to);
          if (edge.to === state.selected) state.focusNodes.add(edge.from);
        }
      }
      refreshRouteClasses();
    }
  }

  function closeDetail() {
    const returnFocus = state.returnFocus;
    closeConflictComparison({ restoreRoute: false });
    detailLayer.hidden = true;
    state.selected = null;
    state.focusNodes.clear();
    state.routeNodes.clear();
    state.evidenceVisible = false;
    state.returnFocus = null;
    app.classList.remove("is-focused");
    state.camera.targetGoal = [0, 0.15, -0.35];
    orientationTitle.textContent = "SECTION 01 / LAGOS";
    orientationHint.textContent = "ground records Â· active work Â· equal lens canopy";
    refreshRouteClasses();
    const fallback = returnFocus?.closest?.("#navigator")
      ? document.querySelector("#navigatorButton")
      : returnFocus;
    if (fallback?.isConnected) fallback.focus({ preventScroll: true });
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

  function revealEvidenceConstellation({ announceUpdate = true } = {}) {
    state.evidenceVisible = true;
    for (const nodeId of data.evidenceConstellation.sourceNodeIds) {
      state.focusNodes.add(nodeId);
    }
    if (announceUpdate) {
      announce(
        `${data.evidenceConstellation.sourceNodeIds.length} traceable source nodes revealed. CLM-01 is accepted only at narrow scope; the record remains draft with effect NONE.`
      );
    }
    refreshRouteClasses();
  }

  function renderConflictComparison() {
    const columns = document.querySelector("#conflictComparisonColumns");
    document.querySelector("#conflictComparisonCaveat").textContent =
      data.conflictView.caveat;
    columns.replaceChildren(
      ...data.conflictView.pathways.map((pathway) => {
        const card = makeElement(
          "article",
          `conflict-card${pathway.id === state.conflictPathwayId ? " is-active" : ""}`
        );
        const trigger = makeElement(
          "button",
          "conflict-card__trigger",
          `${pathway.claimIds.join(" + ")} / ${pathway.title}`
        );
        trigger.type = "button";
        trigger.dataset.pathwayId = pathway.id;
        trigger.setAttribute(
          "aria-pressed",
          String(pathway.id === state.conflictPathwayId)
        );
        trigger.addEventListener("click", () => activateConflictPathway(pathway.id));

        const status = makeElement("p", "conflict-card__status");
        status.append(
          makeElement("span", "", pathway.label),
          makeElement("span", "", pathway.accountStatus),
          makeElement("span", "", pathway.review)
        );
        const summary = makeElement("p", "conflict-card__summary", pathway.summary);
        const limits = makeElement("dl", "conflict-card__facts");
        for (const [term, value] of [
          ["Source trace", pathway.sourceIds.join(" / ")],
          ["Limitation", pathway.limitation],
          ["Needed next", pathway.needed]
        ]) {
          const row = document.createElement("div");
          row.append(makeElement("dt", "", term), makeElement("dd", "", value));
          limits.append(row);
        }
        card.append(trigger, status, summary, limits);
        return card;
      })
    );
  }

  function activateConflictPathway(pathwayId, { focusCard = true } = {}) {
    const pathway =
      data.conflictView.pathways.find((item) => item.id === pathwayId) ??
      data.conflictView.pathways[0];
    state.conflictPathwayId = pathway.id;
    state.routeNodes = new Set(pathway.nodeIds);
    state.focusNodes = new Set(["foundation", ...pathway.nodeIds]);
    state.evidenceVisible = true;
    const position = averageNodePosition(pathway.nodeIds);
    state.camera.targetGoal = position.map((value) => value * 0.22);
    renderConflictComparison();
    orientationTitle.textContent = pathway.title;
    orientationHint.textContent =
      `${pathway.label} / ${pathway.review} / no settled cause`;
    announce(
      `Conflict View. ${pathway.title}. ${pathway.label}. ${pathway.review}. ${pathway.limitation}`
    );
    refreshRouteClasses();
    if (focusCard) {
      document
        .querySelector(`[data-pathway-id="${pathway.id}"]`)
        ?.focus({ preventScroll: true });
    }
  }

  function openConflictView(pathwayId) {
    const selectedNode = nodeById.get(state.selected);
    const targetPathwayId =
      pathwayId ??
      selectedNode?.conflictBranch ??
      data.conflictView.pathways.find((pathway) =>
        pathway.sourceIds.includes(selectedNode?.sourceId)
      )?.id ??
      data.conflictView.pathways[0].id;
    if (
      state.selected !== "thought-causes" &&
      !selectedNode?.conflictBranch
    ) {
      renderDetail("thought-causes");
    }
    conflictComparison.hidden = false;
    detailLayer.classList.add("detail-layer--conflict");
    activateConflictPathway(targetPathwayId, { focusCard: true });
  }

  function renderDetail(nodeId) {
    const node = nodeById.get(nodeId);
    if (!node) return;

    if (detailLayer.hidden) state.returnFocus = document.activeElement;
    closeConflictComparison({ restoreRoute: false });
    state.selected = node.id;
    state.routeNodes.clear();
    state.evidenceVisible = node.id === "condition" || Boolean(node.evidenceSource);
    state.focusNodes = new Set([node.id, "foundation"]);
    for (const edge of data.edges) {
      if (edge.from === node.id) state.focusNodes.add(edge.to);
      if (edge.to === node.id) state.focusNodes.add(edge.from);
    }
    app.classList.add("is-focused");
    detailLayer.hidden = false;
    if (node.id === "condition") revealEvidenceConstellation({ announceUpdate: false });
    document.querySelector("#detailBreadcrumb").textContent =
      `World / ${node.region ?? node.kind} / ${node.title}`;
    document.querySelector("#detailKind").textContent = node.kind;
    const detailTitle = document.querySelector("#detailTitle");
    detailTitle.textContent = node.title;
    detailTitle.tabIndex = -1;
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
    if (node.sourceId) factEntries.push(["Source register ID", node.sourceId]);
    if (node.requestId) factEntries.push(["Request ID", node.requestId]);
    if (node.claimIds?.length) factEntries.push(["Claim trace", node.claimIds.join(" / ")]);
    if (node.reviewScope) factEntries.push(["Review scope", node.reviewScope]);
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
            const relationshipButton = makeElement("button", "relationship-link");
            relationshipButton.type = "button";
            relationshipButton.addEventListener("click", () => renderDetail(otherId));
            relationshipButton.append(
              makeElement("strong", "", edge.relationshipType ?? edge.kind),
              makeElement("span", "", `${edge.label} â†’ ${other?.title ?? otherId}`)
            );
            item.append(relationshipButton);
            return item;
          })
        : [makeElement("li", "", "No explicit relationship is encoded for this object.")])
    );

    const actions = document.querySelector("#detailActions");
    actions.replaceChildren();
    if (node.id === "condition") {
      addDetailAction(
        `Inspect ${data.evidenceConstellation.sourceNodeIds.length} source traces`,
        () => openNavigator("Evidence Constellation"),
        true
      );
      addDetailAction("Open Conflict View", () => openConflictView());
      addDetailAction("Send City Pulse", startCityPulse);
      addDetailAction("Replay governance path", openPathReplay);
    } else if (node.id === "review") {
      addDetailAction("Replay governance path", openPathReplay, true);
    } else if (node.id === "handoff") {
      addDetailAction("Start guided handover", openGuidedHandover, true);
    } else if (node.id === "thoughts") {
      addDetailAction("Browse every open question", () => openNavigator("Open Questions"), true);
      addDetailAction("Open Conflict View", () => openConflictView());
    } else if (node.conflictHub || node.conflictBranch) {
      addDetailAction(
        "Compare unresolved pathways",
        () => openConflictView(node.conflictBranch),
        true
      );
    } else if (
      ["INC-04", "INC-05", "INC-07", "INC-TIME-01"].includes(node.sourceId)
    ) {
      addDetailAction("Compare unresolved pathways", () => openConflictView(), true);
    } else if (node.request) {
      addDetailAction("Return to Open Questions", () => openNavigator("Open Questions"), true);
    }
    addDetailAction("Return to whole cloud", closeDetail);

    state.camera.targetGoal = [
      node.position[0] * 0.22,
      node.position[1] * 0.22,
      node.position[2] * 0.16
    ];
    orientationTitle.textContent = node.title;
    orientationHint.textContent = `${node.label} Â· ${node.status}`;
    announce(
      node.id === "condition"
        ? `${node.title} selected. ${node.label}. ${node.status}. ${data.evidenceConstellation.sourceNodeIds.length} traceable source nodes revealed with limitations.`
        : `${node.title} selected. ${node.label}. ${node.status}.`
    );
    refreshRouteClasses();
    detailTitle.focus({ preventScroll: true });
  }

  document.querySelector(".detail-layer__close").addEventListener("click", closeDetail);
  document.querySelector("#detailBackToWorld").addEventListener("click", close×N¸ÞÚ$z{-®éÜj×Â“°¢vÂçVæ–f÷&ÔÖG&—ƒFgb‡'F–6ÆTÆö6F–öç2çf–Wu&ö¦V7F–öâÂfÇ6RÂf–Wu&ö¦V7F–öâ“°¢vÂçVæ–f÷&Ób‡'F–6ÆTÆö6F–öç2ç—†VÅ&F–òÂ—†VÅ&F–ò“°¢vÂæG&t'&—2†vÂåô”åE2ÂÂ'F–6ÆW2æÆVæwF‚ò2“°¢Ð ¢gVæ7F–öâVÇ6U7G&VæwF‚‡F–ÖRÂVFvT–æFW‚’°¢–b‡7FFRçVÇ6U7F'FVDBÓÓÒçVÆÂ’&WGW&â°¢6öç7BVÆ6VBÒ‡F–ÖRÒ7FFRçVÇ6U7F'FVDB’ò°¢–b†VÆ6VBâ2ãB’°¢7FFRçVÇ6U7F'FVDBÒçVÆÃ°¢7FFRçVÇ6UF&vWG2æ6ÆV"‚“°¢&WGW&â°¢Ð¢6öç7B6VçFW"ÒVFvT–æFW‚¢ã"²ã3°¢&WGW&âÖF‚æÖ‚ƒÂÒÖF‚æ'2†VÆ6VBÒ6VçFW"’¢2ã"“°¢Ð ¢gVæ7F–öâVFvT6öÆ÷"†VFvR’°¢–b†VFvRæ¶–æBÓÓÒ&Wf–FVæ6R×G&6R"’&WGW&â³ãcbÂãcBÂãSeÓ°¢–b†VFvRæ¶–æBÓÓÒ'Vç&W6öÇfVB"’&WGW&â³ã3’ÂãBÂãEÓ°¢–b†VFvRæ¶–æBÓÓÒ&7F—fR×&÷WFR"’&WGW&â³ãC‚ÂãS‚ÂãcÓ°¢–b†VFvRæ¶–æBÓÓÒ&WVÂ×7FæF–ær"’&WGW&â³ãS’ÂãS’ÂãSeÓ°¢–b†VFvRæ¶–æBÓÓÒ'&V6÷&B"ÇÂVFvRæ¶–æBÓÓÒ'&÷fVææ6R"’&WGW&â³ãcBÂãc2ÂãS…Ó°¢–b†VFvRæ¶–æBÓÓÒ'6W&FR×&W7öç6R"’&WGW&â³ãS2ÂãSRÂãS5Ó°¢&WGW&â³ãCbÂãC’ÂãC•Ó°¢Ð ¢gVæ7F–öâVFvU7G&æG2†VFvR’°¢–b†VFvRæ¶–æBÓÓÒ&Wf–FVæ6R×G&6R"’&WGW&â#°¢–b†VFvRæ¶–æBÓÓÒ&7F—fR×&÷WFR"’&WGW&â3°¢–b†VFvRæ¶–æBÓÓÒ'6W&FR×&W7öç6R"’&WGW&â3°¢–b†VFvRæ¶–æBÓÓÒ'&÷fVææ6R"’&WGW&â3°¢–b†VFvRæ¶–æBÓÓÒ&ÖWF†öB"ÇÂVFvRæ¶–æBÓÓÒ'&V6÷&B"’&WGW&â#°¢&WGW&â°¢Ð ¢gVæ7F–öâ&VæFW$VFvW2‡f–Wu&ö¦V7F–öâÂ÷6—F–öç2ÂF–ÖR’°¢vÂæVæ&ÆR†vÂäDUD…õDU5B“°¢vÂæFWF„Ö6²†fÇ6R“°¢vÂçW6U&öw&Ò†Æ–æU&öw&Ò“°¢vÂæVæ&ÆUfW'FW„GG&–$'&’†Æ–æTÆö6F–öç2ç÷6—F–öâ“°¢vÂçVæ–f÷&ÔÖG&—ƒFgb†Æ–æTÆö6F–öç2çf–Wu&ö¦V7F–öâÂfÇ6RÂf–Wu&ö¦V7F–öâ“°¢vÂæ&–æD'VffW"†vÂä%$•ô%TddU"ÂÆ–æT'VffW"“° ¢FFæVFvW2æf÷$V6‚‚†VFvRÂVFvT–æFW‚’Óâ°¢–b†VFvRæWf–FVæ6TöæÇ’bb7FFRæWf–FVæ6Uf—6–&ÆR’&WGW&ã°¢6öç7Bg&öÔæöFRÒæöFT'”–BævWB†VFvRæg&öÒ“°¢6öç7BFôæöFRÒæöFT'”–BævWB†VFvRçFò“°¢–b€¢g&öÔæöFRÇÀ¢FôæöFRÇÀ¢g&öÔæöFRç7FvRâ7FFRçF–ÖVÆ–æU7FvRÇÀ¢FôæöFRç7FvRâ7FFRçF–ÖVÆ–æU7FvP¢’°¢&WGW&ã°¢Ð¢6öç7BVÇ6RÒVFvRçVÇ6TVÆ–v–&ÆRòVÇ6U7G&VæwF‚‡F–ÖRÂVFvT–æFW‚’¢°¢6öç7B&÷WFRÒ7FFRç&÷WFTæöFW2æ†2†VFvRæg&öÒ’bb7FFRç&÷WFTæöFW2æ†2†VFvRçFò“°¢6öç7Bfö7W4VFvRÐ¢7FFRç6VÆV7FVBÇÀ¢VFvRæg&öÒÓÓÒ7FFRç6VÆV7FVBÇÀ¢VFvRçFòÓÓÒ7FFRç6VÆV7FVBÇÀ¢&÷WFS°¢6öç7B6öÆ÷"ÒVFvT6öÆ÷"†VFvR“°¢vÂçVæ–f÷&Ó6gb†Æ–æTÆö6F–öç2æ6öÆ÷"ÂVÇ6Râò³ãc‚Âã3BÂã#EÒ¢6öÆ÷"“°¢6öç7B&6TÇ†Ð¢VÇ6Râ ¢òãs ¢¢&÷WFP¢òãS@¢¢VFvRæ¶–æBÓÓÒ&7F—fR×&÷WFR ¢òãcP¢¢VFvRæ¶–æBÓÓÒ&Wf–FVæ6R×G&6R ¢òãS ¢¢VFvRçV–W@¢òã0¢¢VFvRæ¶–æBÓÓÒ&WVÂ×7FæF–ær ¢òãC@¢¢VFvRæ¶–æBÓÓÒ'&V6÷&B"ÇÂVFvRæ¶–æBÓÓÒ'&÷fVææ6R ¢òãsP¢¢VFvRæ¶–æBÓÓÒ'6W&FR×&W7öç6R ¢òãp¢¢ãCƒ°¢6öç7B7G&æG2ÒVFvU7G&æG2†VFvR“°¢f÷"†ÆWB7G&æBÒ²7G&æBÂ7G&æG3²7G&æB³Ò’°¢6öç7Böfg6WBÒ‡7G&æBÒ‡7G&æG2Ò’ò"’¢ãSS°¢6öç7BfW'F–6W2Ò7W'fUfW'F–6W2€¢÷6—F–öç2ævWB†VFvRæg&öÒ’À¢÷6—F–öç2ævWB†VFvRçFò’À¢VFvRæF6†VBÀ¢†VFvT–æFW‚RR’¢ãCRÀ¢öfg6W@¢“°¢vÂæ'VffW$FF†vÂä%$•ô%TddU"ÂæWrfÆöC3$'&’‡fW'F–6W2’ÂvÂäE”äÔ”5ôE$r“°¢vÂçfW'FW„GG&–%ö–çFW"†Æ–æTÆö6F–öç2ç÷6—F–öâÂ2ÂvÂädÄôBÂfÇ6RÂÂ“°¢vÂçVæ–f÷&Ób€¢Æ–æTÆö6F–öç2æÇ†À¢†&6TÇ†òÖF‚æÖ‚ƒÂ7G&æG2¢ãs"’’¢†fö7W4VFvRò¢ã3"¢“°¢vÂæG&t'&—2†vÂäÄ”äU2ÂÂfW'F–6W2æÆVæwF‚ò2“°¢Ð¢Ò“°¢vÂæFWF„Ö6²‡G'VR“°¢Ð ¢gVæ7F–öâ&VæFW$æöFR†æöFRÂ÷6—F–öâÂf–Wu&ö¦V7F–öâÂ6ÖW&÷6—F–öâÂF–ÖR’°¢6öç7BÖW6‚ÒÖW6†W5¶æöFRç6†UÒóòÖW6†W2ç7†W&S°¢6öç7B—56VÆV7FVBÒ7FFRç6VÆV7FVBÓÓÒæöFRæ–C°¢6öç7B—4†÷fW&VBÒ7FFRæ†÷fW&VBÓÓÒæöFRæ–C°¢6öç7B—5&÷WFRÒ7FFRç&÷WFTæöFW2æ†2†æöFRæ–B“°¢–b†æöFRæWf–FVæ6U6÷W&6Rbb7FFRæWf–FVæ6Uf—6–&ÆRbb—56VÆV7FVBbb—5&÷WFR’&WGW&ã°¢6öç7BVÇ6T7F—fRÐ¢7FFRçVÇ6U7F'FVDBÓÒçVÆÂb`¢7FFRçVÇ6UF&vWG2æ†2†æöFRæ–B’b`¢æöFRçV–WDGW&–æuVÇ6S°¢6öç7BVÇ6UvfRÒVÇ6T7F—fP¢òÖF‚æÖ‚ƒÂÖF‚ç6–â‚‡F–ÖRÒ7FFRçVÇ6U7F'FVDB’¢ã‚’¢¢°¢6öç7BgWGW&RÒæöFRç7FvRâ7FFRçF–ÖVÆ–æU7FvS°¢6öç7BF–ÖÖVBÒ&ööÆVâ‡7FFRç6VÆV7FVB’bb7FFRæfö7W4æöFW2æ†2†æöFRæ–B“°¢6öç7BV×†6—2Ò—56VÆV7FVBÇÂ—5&÷WFRò¢—4†÷fW&VBòãc‚¢VÇ6UvfR¢ã“#°¢6öç7B66ÆRÒæöFRç6—¦R¢ƒ²V×†6—2¢ã"“°¢6öç7B66ÆUfV7F÷"Ò†æöFRç66ÆRóò³ÂÂÒ’æÖ‚‡fÇVR’ÓâfÇVR¢66ÆR“°¢6öç7B&÷FF–öâÒæöFRç7F&ÆRò¢F–ÖR¢ã²æöFRç÷6—F–öå³Ò¢ãc°¢6öç7Bv÷&ÆBÒ×VÇF—Ç”ÖG&–6W2€¢G&ç6ÆF–öäÖG&—‚‡÷6—F–öâ’À¢×VÇF—Ç”ÖG&–6W2€¢&÷FF–öå”ÖG&—‚‡&÷FF–öâ’À¢×VÇF—Ç”ÖG&–6W2€¢&÷FF–öå„ÖG&—‚†æöFRç6†RÓÓÒ'&–ær"òÖF‚å’ò"ãr¢’À¢66ÆTÖG&—‚‡66ÆUfV7F÷"¢¢¢“° ¢vÂçW6U&öw&Ò†ÖW6…&öw&Ò“°¢vÂæ&–æD'VffW"†vÂä%$•ô%TddU"ÂÖW6‚ç÷6—F–öä'VffW"“°¢vÂæVæ&ÆUfW'FW„GG&–$'&’†ÖW6„Æö6F–öç2ç÷6—F–öâ“°¢vÂçfW'FW„GG&–%ö–çFW"†ÖW6„Æö6F–öç2ç÷6—F–öâÂ2ÂvÂädÄôBÂfÇ6RÂÂ“°¢vÂæ&–æD'VffW"†vÂä%$•ô%TddU"ÂÖW6‚ææ÷&ÖÄ'VffW"“°¢vÂæVæ&ÆUfW'FW„GG&–$'&’†ÖW6„Æö6F–öç2ææ÷&ÖÂ“°¢vÂçfW'FW„GG&–%ö–çFW"†ÖW6„Æö6F–öç2ææ÷&ÖÂÂ2ÂvÂädÄôBÂfÇ6RÂÂ“°¢vÂçVæ–f÷&ÔÖG&—ƒFgb†ÖW6„Æö6F–öç2çv÷&ÆBÂfÇ6RÂv÷&ÆB“°¢vÂçVæ–f÷&ÔÖG&—ƒFgb†ÖW6„Æö6F–öç2çf–Wu&ö¦V7F–öâÂfÇ6RÂf–Wu&ö¦V7F–öâ“°¢vÂçVæ–f÷&Ó6gb†ÖW6„Æö6F–öç2æ6öÆ÷"ÂæöFRæ6öÆ÷"“°¢vÂçVæ–f÷&Ó6gb†ÖW6„Æö6F–öç2æ6ÖW&Â6ÖW&÷6—F–öâ“°¢vÂçVæ–f÷&Ób†ÖW6„Æö6F–öç2æV×†6—2ÂV×†6—2“°¢vÂçVæ–f÷&Ób†ÖW6„Æö6F–öç2æg&vÖVçBÂæöFRæg&vÖVçBÇÂæöFRæWf–FVæ6U6÷W&6Rò¢“°¢6öç7B&6TÇ†ÒgWGW&P¢òãCP¢¢æöFRæWf–FVæ6U6÷W&6P¢òãƒ€¢¢æöFRæg&vÖVç@¢òã“@¢¢æöFRçF†÷Vv‡@¢òãC€¢¢æöFRæÖFW&–ÂÓÓÒ&ÆVç2 ¢òãs ¢¢æöFRæ–BÓÓÒ&f÷VæFF–öâ ¢òãC ¢¢æöFRæ¶–æBÓÓÒ$”ÔÕUD$ÄRÄTå2$T4õ$B ¢òãs`¢¢ãƒƒ°¢vÂçVæ–f÷&Ób†ÖW6„Æö6F–öç2æÇ†ÂF–ÖÖVBòÖF‚æÖ–â†&6TÇ†Âã2’¢&6TÇ†“°¢vÂæG&t'&—2†vÂåE$”ätÄU2ÂÂÖW6‚æ6÷VçB“°¢Ð ¢gVæ7F–öâ6†÷VÆE6†÷tÆ&VÂ†æöFR’°¢–b†æöFRç7FvRâ7FFRçF–ÖVÆ–æU7FvR’&WGW&âfÇ6S°¢–b†æöFRæWf–FVæ6U6÷W&6R’&WGW&â7FFRæWf–FVæ6Uf—6–&ÆS°¢–b†æöFRç&–Ö'’’&WGW&âG'VS°¢–b‡7FFRç6VÆV7FVBÓÓÒæöFRæ–BÇÂ7FFRæ†÷fW&VBÓÓÒæöFRæ–BÇÂ7FFRç&÷WFTæöFW2æ†2†æöFRæ–B’’°¢&WGW&âG'VS°¢Ð¢–b†æöFRçF†÷Vv‡Bbb7FFRç6VÆV7FVBÓÓÒ'F†÷Vv‡G2"’&WGW&âG'VS°¢–b†æöFRæ¶–æBÓÓÒ$”ÔÕUD$ÄRÄTå2$T4õ$B"’°¢&WGW&â7FFRç6VÆV7FVBÓÓÒÆVç2ÒG¶æöFRæ–Bç&WÆ6R‚'&V6÷&BÒ"Â""—Ö°¢Ð¢&WGW&âfÇ6S°¢Ð ¢gVæ7F–öâWFFTÆ&VÇ2‡f–Wu&ö¦V7F–öâÂ÷6—F–öç2’°¢6öç7Bv–GF‚Ò6çf2æ6Æ–VçEv–GFƒ°¢6öç7B†V–v‡BÒ6çf2æ6Æ–VçD†V–v‡C°¢7FFRç&ö¦V7FVBæ6ÆV"‚“°¢f÷"†6öç7BæöFRöbFFææöFW2’°¢6öç7B6Æ—ÒG&ç6f÷&Õö–çB‡f–Wu&ö¦V7F–öâÂ÷6—F–öç2ævWB†æöFRæ–B’“°¢6öç7BVÆVÖVçBÒÆ&VÄVÆVÖVçG2ævWB†æöFRæ–B“°¢–b†6Æ—³5ÒÃÒã’°¢VÆVÖVçBæ6Æ74Æ—7Bç&VÖ÷fR‚&—2×f—6–&ÆR"“°¢6öçF–çVS°¢Ð¢6öç7Bæ÷&ÖÆ—¦VE‚Ò6Æ—³Òò6Æ—³5Ó°¢6öç7Bæ÷&ÖÆ—¦VE’Ò6Æ—³Òò6Æ—³5Ó°¢6öç7B‚Ò†æ÷&ÖÆ—¦VE‚¢ãR²ãR’¢v–GFƒ°¢6öç7B’Ò‚Öæ÷&ÖÆ—¦VE’¢ãR²ãR’¢†V–v‡C°¢6öç7Böå67&VVâÒæ÷&ÖÆ—¦VE‚âÓã#Rbbæ÷&ÖÆ—¦VE‚Âã#Rbbæ÷&ÖÆ—¦VE’âÓã"bbæ÷&ÖÆ—¦VE’Âã#°¢6öç7Bf—6–&ÆRÒöå67&VVâbb6†÷VÆE6†÷tÆ&VÂ†æöFR“°¢VÆVÖVçBç7G–ÆRæÆVgBÒG·‡×†°¢6öç7BÆ&VÅF÷ÒæöFRæg&vÖVçBÇÂæöFRæWf–FVæ6U6÷W&6P¢ò’²#€¢¢æöFRæ¶–æBÓÓÒ$ÄTå2 ¢ò’²#@¢¢æöFRæ–BÓÓÒ&6öæF—F–öâ ¢ò’²#P¢¢’ÒæöFRç6—¦R¢#bÒc°¢VÆVÖVçBç7G–ÆRçF÷ÒG¶Æ&VÅF÷×†°¢VÆVÖVçBæ6Æ74Æ—7BçFövvÆR‚&—2×f—6–&ÆR"Âf—6–&ÆR“°¢7FFRç&ö¦V7FVBç6WB†æöFRæ–BÂ°¢‚À¢’À¢&F—W3¢ÖF‚æÖ‚ƒ#ÂæöFRç6—¦R¢C"’À¢FWFƒ¢6Æ—³5ÒÀ¢7F—fS ¢æöFRç7FvRÃÒ7FFRçF–ÖVÆ–æU7FvRb`¢‚æöFRæWf–FVæ6U6÷W&6RÇÂ7FFRæWf–FVæ6Uf—6–&ÆR¢Ò“°¢Ð¢&Vg&W6…&÷WFT6Æ76W2‚“°¢Ð ¢gVæ7F–öâWFFTwV–FTÆ&VÇ2‡f–Wu&ö¦V7F–öâ’°¢6öç7Bv–GF‚Ò6çf2æ6Æ–VçEv–GFƒ°¢6öç7B†V–v‡BÒ6çf2æ6Æ–VçD†V–v‡C°¢f÷"†6öç7BwV–FRöbFFæwV–FW2óòµÒ’°¢6öç7BVÆVÖVçBÒwV–FTÆ&VÄVÆVÖVçG2ævWB†wV–FRæ–B“°¢6öç7B6Æ—ÒG&ç6f÷&Õö–çB‡f–Wu&ö¦V7F–öâÂwV–FRæÆ&VÅ÷6—F–öâ“°¢–b‚VÆVÖVçBÇÂ6Æ—³5ÒÃÒã’°¢VÆVÖVçCòæ6Æ74Æ—7Bç&VÖ÷fR‚&—2×f—6–&ÆR"“°¢6öçF–çVS°¢Ð¢6öç7Bæ÷&ÖÆ—¦VE‚Ò6Æ—³Òò6Æ—³5Ó°¢6öç7Bæ÷&ÖÆ—¦VE’Ò6Æ—³Òò6Æ—³5Ó°¢6öç7Böå67&VVâÐ¢æ÷&ÖÆ—¦VE‚âÓã‚b`¢æ÷&ÖÆ—¦VE‚Âã‚b`¢æ÷&ÖÆ—¦VE’âÓãb`¢æ÷&ÖÆ—¦VE’Âã°¢VÆVÖVçBç7G–ÆRæÆVgBÒG²†æ÷&ÖÆ—¦VE‚¢ãR²ãR’¢v–GF‡×†°¢VÆVÖVçBç7G–ÆRçF÷ÒG²‚Öæ÷&ÖÆ—¦VE’¢ãR²ãR’¢†V–v‡G×†°¢VÆVÖVçBæ6Æ74Æ—7BçFövvÆR‚&—2×f—6–&ÆR"Âöå67&VVâ“°¢Ð¢Ð ¢gVæ7F–öâWFFUF–ÖTÆ&VÇ2‡f–Wu&ö¦V7F–öâ’°¢6öç7Bv–GF‚Ò6çf2æ6Æ–VçEv–GFƒ°¢6öç7B†V–v‡BÒ6çf2æ6Æ–VçD†V–v‡C°¢f÷"†6öç7BÖ&¶W"öbFFçF–ÖTÖ&¶W'2óòµÒ’°¢6öç7BVÆVÖVçBÒF–ÖTÆ&VÄVÆVÖVçG2ævWB†Ö&¶W"ç7FvR“°¢6öç7B6Æ—ÒG&ç6f÷&Õö–çB‡f–Wu&ö¦V7F–öâÂÖ&¶W"ç÷6—F–öâ“°¢–b‚VÆVÖVçBÇÂ6Æ—³5ÒÃÒã’°¢VÆVÖVçCòæ6Æ74Æ—7Bç&VÖ÷fR‚&—2×f—6–&ÆR"“°¢6öçF–çVS°¢Ð¢6öç7Bæ÷&ÖÆ—¦VE‚Ò6Æ—³Òò6Æ—³5Ó°¢6öç7Bæ÷&ÖÆ—¦VE’Ò6Æ—³Òò6Æ—³5Ó°¢6öç7Böå67&VVâÐ¢æ÷&ÖÆ—¦VE‚âÓã"b`¢æ÷&ÖÆ—¦VE‚Âã"b`¢æ÷&ÖÆ—¦VE’âÓãRb`¢æ÷&ÖÆ—¦VE’ÂãS°¢VÆVÖVçBç7G–ÆRæÆVgBÒG²†æ÷&ÖÆ—¦VE‚¢ãR²ãR’¢v–GF‡×†°¢VÆVÖVçBç7G–ÆRçF÷ÒG²‚Öæ÷&ÖÆ—¦VE’¢ãR²ãR’¢†V–v‡B²G×†°¢VÆVÖVçBæ6Æ74Æ—7BçFövvÆR€¢&—2×f—6–&ÆR"À¢öå67&VVâbbÖ&¶W"ç7FvRÃÒ7FFRçF–ÖVÆ–æU7FvP¢“°¢VÆVÖVçBæ6Æ74Æ—7BçFövvÆR‚&—2Ö–ÆÇW7G&F—fR"ÂÖ&¶W"æ¶æ÷vâ“°¢Ð¢Ð ¢gVæ7F–öâ&W6—¦T6çf2‚’°¢6öç7B—†VÅ&F–òÒÖF‚æÖ–â‡v–æF÷ræFWf–6U—†VÅ&F–òÇÂÂ"“°¢6öç7Bv–GF‚ÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"†6çf2æ6Æ–VçEv–GF‚¢—†VÅ&F–ò’“°¢6öç7B†V–v‡BÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"†6çf2æ6Æ–VçD†V–v‡B¢—†VÅ&F–ò’“°¢–b†6çf2çv–GF‚ÓÒv–GF‚ÇÂ6çf2æ†V–v‡BÓÒ†V–v‡B’°¢6çf2çv–GF‚Òv–GFƒ°¢6çf2æ†V–v‡BÒ†V–v‡C°¢Ð¢vÂçf–Ww÷'BƒÂÂv–GF‚Â†V–v‡B“°¢&WGW&â—†VÅ&F–ó°¢Ð ¢gVæ7F–öâ6ÖW&÷6—F–öâ‚’°¢6öç7B6ÖW&Ò7FFRæ6ÖW&°¢6öç7B†÷&—¦öçFÂÒÖF‚æ6÷2†6ÖW&ç—F6‚’¢6ÖW&æF—7Fæ6S°¢&WGW&â°¢6ÖW&çF&vWE³Ò²ÖF‚ç6–â†6ÖW&ç–r’¢†÷&—¦öçFÂÀ¢6ÖW&çF&vWE³Ò²ÖF‚ç6–â†6ÖW&ç—F6‚’¢6ÖW&æF—7Fæ6RÀ¢6ÖW&çF&vWE³%Ò²ÖF‚æ6÷2†6ÖW&ç–r’¢†÷&—¦öçFÀ¢Ó°¢Ð ¢gVæ7F–öâ&VæFW"‡F–ÖR’°¢6öç7B—†VÅ&F–òÒ&W6—¦T6çf2‚“°¢f÷"†ÆWB–æFW‚Ò²–æFW‚Â3²–æFW‚³Ò’°¢7FFRæ6ÖW&çF&vWE¶–æFW…Ò³Ð¢‡7FFRæ6ÖW&çF&vWDvöÅ¶–æFW…ÒÒ7FFRæ6ÖW&çF&vWE¶–æFW…Ò’¢‡&VGV6VDÖ÷F–öâò¢ãSR“°¢Ð ¢6öç7BW–RÒ6ÖW&÷6—F–öâ‚“°¢6öç7B&ö¦V7F–öâÒW'7V7F—fTÖG&—‚€¢ÖF‚å’òBãÀ¢6çf2æ6Æ–VçEv–GF‚òÖF‚æÖ‚ƒÂ6çf2æ6Æ–VçD†V–v‡B’À¢ãÀ¢ƒ ¢“°¢6öç7Bf–WrÒÆöö´DÖG&—‚†W–RÂ7FFRæ6ÖW&çF&vWB“°¢6öç7Bf–Wu&ö¦V7F–öâÒ×VÇF—Ç”ÖG&–6W2‡&ö¦V7F–öâÂf–Wr“°¢6öç7B÷6—F–öç2ÒæWrÖ€¢FFææöFW2æÖ‚†æöFR’Óâ¶æöFRæ–BÂæöFTfÆöE÷6—F–öâ†æöFRÂF–ÖR•Ò¢“° ¢vÂæ6ÆV$6öÆ÷"ƒÂÂÂ“°¢vÂæ6ÆV"†vÂä4ôÄõ%ô%TddU%ô$•BÂvÂäDUD…ô%TddU%ô$•B“°¢vÂæVæ&ÆR†vÂä$ÄTäB“°¢vÂæ&ÆVæDgVæ2†vÂå5$5ôÅ„ÂvÂäôäUôÔ”åU5õ5$5ôÅ„“°¢vÂæVæ&ÆR†vÂäDUD…õDU5B“°¢vÂæFWF„gVæ2†vÂäÄUTÂ“° ¢&VæFW%'F–6ÆW2‡f–Wu&ö¦V7F–öâÂ—†VÅ&F–ò“°¢&VæFW$wV–FW2‡f–Wu&ö¦V7F–öâÂ÷6—F–öç2“°¢&VæFW$VFvW2‡f–Wu&ö¦V7F–öâÂ÷6—F–öç2ÂF–ÖR“°¢f÷"†6öç7BæöFRöbFFææöFW2’°¢&VæFW$æöFR†æöFRÂ÷6—F–öç2ævWB†æöFRæ–B’Âf–Wu&ö¦V7F–öâÂW–RÂF–ÖR“°¢Ð¢WFFTÆ&VÇ2‡f–Wu&ö¦V7F–öâÂ÷6—F–öç2“°¢WFFTwV–FTÆ&VÇ2‡f–Wu&ö¦V7F–öâ“°¢WFFUF–ÖTÆ&VÇ2‡f–Wu&ö¦V7F–öâ“°¢v–æF÷rç&WVW7Dæ–ÖF–öäg&ÖR‡&VæFW"“°¢Ð ¢gVæ7F–öâ–6´æöFR†6Æ–VçE‚Â6Æ–VçE’’°¢6öç7B&V7FævÆRÒ6çf2ævWD&÷VæF–æt6Æ–VçE&V7B‚“°¢6öç7B‚Ò6Æ–VçE‚Ò&V7FævÆRæÆVgC°¢6öç7B’Ò6Æ–VçE’Ò&V7FævÆRçF÷°¢ÆWBv–ææW"ÒçVÆÃ°¢ÆWB&W7E66÷&RÒçVÖ&W"åõ4•D•dUô”äd”ä•E“°¢f÷"†6öç7B¶æöFT–BÂ&ö¦V7FVEÒöb7FFRç&ö¦V7FVB’°¢–b‚&ö¦V7FVBæ7F—fR’6öçF–çVS°¢6öç7BF—7Fæ6RÒÖF‚æ‡—÷B‡&ö¦V7FVBç‚Ò‚Â&ö¦V7FVBç’Ò’“°¢–b†F—7Fæ6RÃÒ&ö¦V7FVBç&F—W2’°¢6öç7B66÷&RÒF—7Fæ6R²&ö¦V7FVBæFWF‚¢ãS°¢–b‡66÷&RÂ&W7E66÷&R’°¢&W7E66÷&RÒ66÷&S°¢v–ææW"ÒæöFT–C°¢Ð¢Ð¢Ð¢&WGW&âv–ææW#°¢Ð ¢6çf2æFDWfVçDÆ—7FVæW"‚'ö–çFW&F÷vâ"Â†WfVçB’Óâ°¢6çf2ç6WEö–çFW$6GW&R†WfVçBçö–çFW$–B“°¢7FFRçö–çFW"Ò°¢–C¢WfVçBçö–çFW$–BÀ¢7F'Eƒ¢WfVçBæ6Æ–VçE‚À¢7F'E“¢WfVçBæ6Æ–VçE’À¢&Wf–÷W5ƒ¢WfVçBæ6Æ–VçE‚À¢&Wf–÷W5“¢WfVçBæ6Æ–VçE’À¢Ö÷fVC¢fÇ6P¢Ó°¢6çf2æ6Æ74Æ—7BæFB‚&—2ÖG&vv–ær"“°¢Ò“° ¢6çf2æFDWfVçDÆ—7FVæW"‚'ö–çFW&Ö÷fR"Â†WfVçB’Óâ°¢–b‡7FFRçö–çFW#òæ–BÓÓÒWfVçBçö–çFW$–B’°¢6öç7BFVÇF‚ÒWfVçBæ6Æ–VçE‚Ò7FFRçö–çFW"ç&Wf–÷W5ƒ°¢6öç7BFVÇF’ÒWfVçBæ6Æ–VçE’Ò7FFRçö–çFW"ç&Wf–÷W5“°¢–b„ÖF‚æ‡—÷B†WfVçBæ6Æ–VçE‚Ò7FFRçö–çFW"ç7F'E‚ÂWfVçBæ6Æ–VçE’Ò7FFRçö–çFW"ç7F'E’’âR’°¢7FFRçö–çFW"æÖ÷fVBÒG'VS°¢Ð¢–b‡7FFRçö–çFW"æÖ÷fVB’°¢7FFRæ6ÖW&ç–rÓÒFVÇF‚¢ãc°¢7FFRæ6ÖW&ç—F6‚ÒÖF‚æÖ‚‚ÓãS"ÂÖF‚æÖ–âƒãcbÂ7FFRæ6ÖW&ç—F6‚²FVÇF’¢ãR’“°¢Ð¢7FFRçö–çFW"ç&Wf–÷W5‚ÒWfVçBæ6Æ–VçEƒ°¢7FFRçö–çFW"ç&Wf–÷W5’ÒWfVçBæ6Æ–VçE“°¢&WGW&ã°¢Ð¢7FFRæ†÷fW&VBÒ–6´æöFR†WfVçBæ6Æ–VçE‚ÂWfVçBæ6Æ–VçE’“°¢Ò“° ¢gVæ7F–öâf–æ—6…ö–çFW"†WfVçB’°¢–b‚7FFRçö–çFW"ÇÂ7FFRçö–çFW"æ–BÓÒWfVçBçö–çFW$–B’&WGW&ã°¢–b‚7FFRçö–çFW"æÖ÷fVB’°¢6öç7B–6¶VBÒ–6´æöFR†WfVçBæ6Æ–VçE‚ÂWfVçBæ6Æ–VçE’“°¢–b‡–6¶VB’&VæFW$FWF–Â‡–6¶VB“°¢Ð¢7FFRçö–çFW"ÒçVÆÃ°¢6çf2æ6Æ74Æ—7Bç&VÖ÷fR‚&—2ÖG&vv–ær"“°¢Ð ¢6çf2æFDWfVçDÆ—7FVæW"‚'ö–çFW'W"Âf–æ—6…ö–çFW"“°¢6çf2æFDWfVçDÆ—7FVæW"‚'ö–çFW&6æ6VÂ"Âf–æ—6…ö–çFW"“°¢6çf2æFDWfVçDÆ—7FVæW"‚'ö–çFW&ÆVfR"Â‚’Óâ°¢–b‚7FFRçö–çFW"’7FFRæ†÷fW&VBÒçVÆÃ°¢Ò“°¢6çf2æFDWfVçDÆ—7FVæW"€¢'v†VVÂ"À¢†WfVçB’Óâ°¢WfVçBç&WfVçDFVfVÇB‚“°¢7FFRæ6ÖW&æF—7Fæ6RÒÖF‚æÖ‚ƒ‚ã"ÂÖF‚æÖ–âƒ#"Â7FFRæ6ÖW&æF—7Fæ6R²WfVçBæFVÇF’¢ã’’“°¢ÒÀ¢²76—fS¢fÇ6RÐ¢“° ¢WFFUF–ÖVÆ–æU&VF÷WB‚“°¢v–æF÷rç&WVW7Dæ–ÖF–öäg&ÖR‡&VæFW"“°§Ò’‚“°
const kikxApp = kikxSdk.createApp();

const $sessions = $("#sessions");
const $loadingScreen = $("#loading-screen");

const mutedIcon = `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    aria-label="Inactive session"
    role="img"
  >
    <path d="M0 0h24v24H0z" fill="none" />
    <path
      fill="currentColor"
      d="M19.8 22.6L17.15 20H6.5q-2.3 0-3.9-1.6T1 14.5q0-1.92 1.19-3.42q1.19-1.51 3.06-1.93q.08-.2.15-.39q.1-.19.15-.41L1.4 4.2l1.4-1.4l18.4 18.4M6.5 18h8.65L7.1 9.95q-.05.28-.07.55q-.03.23-.03.5h-.5q-1.45 0-2.47 1.03Q3 13.05 3 14.5T4.03 17q1.02 1 2.47 1m15.1.75l-1.45-1.4q.43-.35.64-.81T21 15.5q0-1.05-.73-1.77q-.72-.73-1.77-.73H17v-2q0-2.07-1.46-3.54Q14.08 6 12 6q-.67 0-1.3.16q-.63.17-1.2.52L8.05 5.23q.88-.6 1.86-.92Q10.9 4 12 4q2.93 0 4.96 2.04Q19 8.07 19 11q1.73.2 2.86 1.5q1.14 1.28 1.14 3q0 1-.37 1.81q-.38.84-1.03 1.44m-6.77-6.72"
    />
  </svg>
`;

function normalizeSession(session) {
  if (!session || typeof session !== "object") {
    return null;
  }

  if (session.id == null) {
    return null;
  }

  return {
    id: String(session.id),
    name: session.name == null ? "" : String(session.name),
    active: Boolean(session.active),
    appsCount: Number.isFinite(Number(session.apps_count))
      ? Number(session.apps_count)
      : 0,
    createdAt: session.created_at ? new Date(session.created_at) : null
  };
}

function createSessionElement(session) {
  const $card = $("<div>", {
    class:
      "session-card flex items-center justify-between gap-3 p-3 mb-2 " +
      "rounded-lg bg-white/20 shadow-sm border border-white/20"
  });

  const $info = $("<div>", {
    class: "flex flex-col"
  });

  const $titleRow = $("<div>", {
    class: "flex gap-1 items-center"
  });

  const $name = $("<span>", {
    class: "font-semibold text-sm text-white",
    text: session.name || `Session ${session.id}`
  });

  const $status = $("<span>");

  if (!session.active) {
    $status.html(mutedIcon);
  }

  const $id = $("<span>", {
    class: "text-xs text-white/70",
    text: `ID: ${session.id}`
  });

  const $apps = $("<span>", {
    class: "text-xs text-white/70",
    text: `Apps: ${session.appsCount}`
  });

  const createdText =
    session.createdAt && !Number.isNaN(session.createdAt.getTime())
      ? session.createdAt.toLocaleString()
      : "Unknown";

  const $created = $("<span>", {
    class: "text-xs text-white/70",
    text: `Created: ${createdText}`
  });

  const $closeButton = $("<button>", {
    type: "button",
    class:
      "close-session w-7 h-7 flex items-center justify-center " +
      "rounded-full bg-white/10 text-white font-bold",
    title: "Close session",
    "aria-label": `Close ${session.name || `session ${session.id}`}`
  })
    .text("✕")
    .data("sessionId", session.id);

  $titleRow.append($name, $status);
  $info.append($titleRow, $id, $apps, $created);
  $card.append($info, $closeButton);

  return $card;
}

function renderInfo(data) {
  $sessions.empty();

  const sessions = Array.isArray(data?.sessions)
    ? data.sessions.map(normalizeSession).filter(Boolean)
    : [];

  if (sessions.length === 0) {
    $("<div>", {
      class: "flex-1 flex justify-center items-center opacity-60",
      text: "No sessions"
    }).appendTo($sessions);

    return;
  }

  const fragment = $(document.createDocumentFragment());

  for (const session of sessions) {
    fragment.append(createSessionElement(session));
  }

  $sessions.append(fragment);
}

async function closeSession(sessionID, $button) {
  const id = String(sessionID ?? "").trim();

  if (!id || $button.prop("disabled")) {
    return;
  }

  $button.prop("disabled", true);

  try {
    const { error } = await kikxApp.system.closeSession(id);

    if (error) {
      console.error("Failed to close session:", error);
      $button.prop("disabled", false);
      return;
    }

    // Remove only the card associated with the button that was clicked.
    $button.closest(".session-card").remove();

    await fetchAndRender();
  } catch (error) {
    console.error("Unexpected error while closing session:", error);
    $button.prop("disabled", false);
  }
}

async function fetchAndRender() {
  try {
    const info = await kikxApp.system.sessionsInfo();

    if (info?.error) {
      console.error("Failed to fetch session info:", info.error);
      return;
    }

    if (info?.data) {
      renderInfo(info.data);
    }
  } catch (error) {
    console.error("Unexpected error while fetching sessions:", error);
  }
}

$sessions.on("click", ".close-session", function () {
  const $button = $(this);
  const sessionID = $button.data("sessionId");

  closeSession(sessionID, $button);
});

async function main() {
  $loadingScreen.hide();
  await fetchAndRender();
}

$(main);

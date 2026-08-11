//
const kikxApp = kikxSdk.createApp();

const closeSession = async sessionID => {
  const res = await kikxApp.system.closeSession(sessionID);

  if (!res.error) $(`#${sessionID}`).remove();
};

const renderInfo = data => {
  const $sessions = $("#sessions");
  $sessions.empty();

  const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
    <path d="M0 0h24v24H0z" fill="none" />
    <path fill="currentColor" d="M19.8 22.6L17.15 20H6.5q-2.3 0-3.9-1.6T1 14.5q0-1.92 1.19-3.42q1.19-1.51 3.06-1.93q.08-.2.15-.39q.1-.19.15-.41L1.4 4.2l1.4-1.4l18.4 18.4M6.5 18h8.65L7.1 9.95q-.05.28-.07.55q-.03.23-.03.5h-.5q-1.45 0-2.47 1.03Q3 13.05 3 14.5T4.03 17q1.02 1 2.47 1m15.1.75l-1.45-1.4q.43-.35.64-.81T21 15.5q0-1.05-.73-1.77q-.72-.73-1.77-.73H17v-2q0-2.07-1.46-3.54Q14.08 6 12 6q-.67 0-1.3.16q-.63.17-1.2.52L8.05 5.23q.88-.6 1.86-.92Q10.9 4 12 4q2.93 0 4.96 2.04Q19 8.07 19 11q1.73.2 2.86 1.5q1.14 1.28 1.14 3q0 1-.37 1.81q-.38.84-1.03 1.44m-6.77-6.72" />
  </svg>
  `;

  data.sessions.forEach(sessionData => {
    $sessions.append(`
      <div
        id="${sessionData.id}"
        class="flex items-center justify-between gap-3 p-3 mb-2
         rounded-lg bg-white/30
         shadow-sm
         border border-white/20"
      >
        <div class="flex flex-col">
          <div class="flex gap-1 items-center">
            <span class="font-semibold text-sm text-white">
              ${sessionData.name || `Session ${sessionData.id}`}
            </span>
            <span>${sessionData.active ? "" : icon}</span>
          </div>

          <span class="text-xs text-white/70">
            ID: ${sessionData.id}
          </span>

          <span class="text-xs text-white/70">
            Apps: ${sessionData.apps_count}
          </span>

          <span class="text-xs text-white/70">
            Created: ${new Date(sessionData.created_at).toLocaleString()}
          </span>
        </div>

        <button
          onclick="closeSession('${sessionData.id}')"
          class="w-7 h-7 flex items-center justify-center
            rounded-full bg-red-500/80 text-white font-bold"
          title="Close session"
        >
          ✕
        </button>
      </div>
    `);
  });
};

async function main() {
  $("#loading-screen").hide();
  //
  const fetchInfo = async () => {
    const info = await kikxApp.system.sessionsInfo();
    if (info.data) {
      renderInfo(info.data);
    }
  };

  await fetchInfo();
}

$(main);

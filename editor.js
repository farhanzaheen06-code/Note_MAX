// ===== EDITOR - SIMPLIFIED FOR PEN DRAWING ONLY =====
const Editor = (() => {
  let currentNote = null;
  let autoSaveTimer = null;

  function init() {
    setupNoteActions();
    setupTitleInput();
  }

  function setupNoteActions() {
    document.getElementById('pinBtn')?.addEventListener('click', async () => {
      if (!currentNote) return;
      currentNote.pinned = !currentNote.pinned;
      await saveCurrentNote();
      updatePinBtn();
      UI.showToast(currentNote.pinned ? 'Pinned 📌' : 'Unpinned');
      NoteApp.refreshNoteList();
    });

    document.getElementById('favBtn')?.addEventListener('click', async () => {
      if (!currentNote) return;
      currentNote.favorite = !currentNote.favorite;
      await saveCurrentNote();
      updateFavBtn();
      UI.showToast(currentNote.favorite ? 'Favorited ❤️' : 'Unfavorited');
      NoteApp.refreshNoteList();
    });

    document.getElementById('exportNoteBtn')?.addEventListener('click', () => {
      UI.showExportModal();
    });

    document.getElementById('deleteNoteBtn')?.addEventListener('click', async () => {
      if (!currentNote) return;
      if (!confirm('Move to trash?')) return;
      currentNote.trashed = true;
      currentNote.modifiedAt = Date.now();
      await DB.put(DB.STORES.NOTES, currentNote);
      UI.showToast('Moved to trash 🗑');
      closeEditor();
      NoteApp.refreshNoteList();
    });

    // Add Page Button
    document.getElementById('addPageBtn')?.addEventListener('click', () => {
      UI.showToast('Multi-page coming soon!');
    });

    // Insert Image
    document.getElementById('mediaBtn')?.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        UI.showToast('Image insertion coming soon!');
      };
      input.click();
    });
  }

  function setupTitleInput() {
    document.getElementById('titleInput')?.addEventListener('input', e => {
      if (!currentNote) return;
      currentNote.title = e.target.value;
      triggerAutoSave();
    });
  }

  function updatePinBtn() {
    const btn = document.getElementById('pinBtn');
    if (btn) btn.classList.toggle('active', !!currentNote?.pinned);
  }

  function updateFavBtn() {
    const btn = document.getElementById('favBtn');
    if (btn) btn.classList.toggle('active', !!currentNote?.favorite);
  }

  function loadNote(note) {
    currentNote = note;
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('editorContent').classList.remove('hidden');
    document.getElementById('titleInput').value = note.title || '';
    updatePinBtn();
    updateFavBtn();
    
    // Load drawing strokes
    setTimeout(() => {
      Canvas.loadStrokes(note.strokes || []);
      Canvas.drawBackground();
    }, 50);
  }

  function closeEditor() {
    currentNote = null;
    document.getElementById('emptyState').classList.remove('hidden');
    document.getElementById('editorContent').classList.add('hidden');
    document.querySelectorAll('.note-item').forEach(i => i.classList.remove('active'));
  }

  function triggerAutoSave() {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(saveCurrentNote, 1500);
  }

  async function saveCurrentNote() {
    if (!currentNote) return;
    clearTimeout(autoSaveTimer);
    currentNote.title = document.getElementById('titleInput')?.value || 'Untitled';
    currentNote.strokes = Canvas.getStrokes();
    currentNote.modifiedAt = Date.now();
    await DB.put(DB.STORES.NOTES, currentNote);
    NoteApp.updateNoteItem(currentNote);
  }

  function getCurrentNote() { return currentNote; }

  // Auto-save every 3 seconds while drawing
  setInterval(() => {
    if (currentNote) saveCurrentNote();
  }, 3000);

  return {
    init, loadNote, saveCurrentNote, closeEditor, getCurrentNote
  };
})();

// ===== EDITOR MODULE =====
const Editor = (() => {
  let currentNote = null;
  let autoSaveTimer = null;
  let checklistItems = [];

  function init() {
    setupFormatBar();
    setupChecklist();
    setupTabs();
    setupNoteActions();
    setupImageInsert();
  }

  // ===== TABS =====
  function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        switchTab(tab);
      });
    });
  }

  function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });

    document.querySelectorAll('.tab-panel').forEach(p => {
      p.classList.add('hidden');
    });

    const panel = document.getElementById(tab + 'Panel');
    if (panel) {
      panel.classList.remove('hidden');
    }

    if (tab === 'draw') {
      setTimeout(() => {
        Canvas.drawBackground();
        Canvas.loadStrokes(currentNote?.strokes || []);
      }, 50);
    }
  }

  // ===== FORMAT BAR =====
  function setupFormatBar() {
    document.querySelectorAll('.fmt-btn[data-cmd]').forEach(btn => {
      btn.addEventListener('mousedown', e => {
        e.preventDefault();
        const cmd = btn.dataset.cmd;
        const val = btn.dataset.val || null;
        document.execCommand(cmd, false, val);
        document.getElementById('richEditor').focus();
      });
    });

    // Text color
    const textColor = document.getElementById('textColorPicker');
    textColor?.addEventListener('input', e => {
      document.execCommand('foreColor', false, e.target.value);
    });

    // Font size
    const fontSize = document.getElementById('fontSizeSelect');
    fontSize?.addEventListener('change', e => {
      document.execCommand('fontSize', false, e.target.value);
    });

    // Font family
    const fontFamily = document.getElementById('fontFamilySelect');
    fontFamily?.addEventListener('change', e => {
      document.execCommand('fontName', false, e.target.value);
    });

    // Divider
    document.getElementById('insertDividerBtn')?.addEventListener('click', () => {
      document.execCommand('insertHTML', false, '<hr/>');
    });

    // Code Block
    document.getElementById('insertCodeBtn')?.addEventListener('click', () => {
      document.execCommand('insertHTML', false, '<pre><code>code here</code></pre>');
    });

    // Link
    document.getElementById('insertLinkBtn')?.addEventListener('click', () => {
      const url = prompt('Enter URL:');
      if (url) document.execCommand('createLink', false, url);
    });

    // Rich editor auto save
    document.getElementById('richEditor')?.addEventListener('input', () => {
      updateWordCount();
      triggerAutoSave();
    });
  }

  // ===== IMAGE INSERT =====
  function setupImageInsert() {
    document.getElementById('insertImageBtn')?.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
          document.execCommand('insertHTML', false, `<img src="${ev.target.result}" alt="image" />`);
        };
        reader.readAsDataURL(file);
      };
      input.click();
    });
  }

  // ===== WORD COUNT =====
  function updateWordCount() {
    if (!currentNote) return;
    const editor = document.getElementById('richEditor');
    const text = editor?.innerText || '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;
    const date = new Date(currentNote.modifiedAt).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    const metaEl = document.getElementById('metaInfo');
    if (metaEl) {
      metaEl.textContent = `${date} · ${words} word${words !== 1 ? 's' : ''} · ${chars} chars`;
    }
  }

  // ===== NOTE ACTIONS =====
  function setupNoteActions() {
    document.getElementById('pinBtn')?.addEventListener('click', async () => {
      if (!currentNote) return;
      currentNote.pinned = !currentNote.pinned;
      await saveCurrentNote();
      updatePinBtn();
      UI.showToast(currentNote.pinned ? 'Note pinned 📌' : 'Note unpinned');
      NoteApp.refreshNoteList();
    });

    document.getElementById('favBtn')?.addEventListener('click', async () => {
      if (!currentNote) return;
      currentNote.favorite = !currentNote.favorite;
      await saveCurrentNote();
      updateFavBtn();
      UI.showToast(currentNote.favorite ? 'Added to favorites ❤️' : 'Removed from favorites');
      NoteApp.refreshNoteList();
    });

    document.getElementById('tagNoteBtn')?.addEventListener('click', () => {
      UI.showTagModal();
    });

    document.getElementById('exportNoteBtn')?.addEventListener('click', () => {
      UI.showExportModal();
    });

    document.getElementById('deleteNoteBtn')?.addEventListener('click', async () => {
      if (!currentNote) return;
      if (!confirm('Move this note to trash?')) return;
      currentNote.trashed = true;
      currentNote.modifiedAt = Date.now();
      await DB.put(DB.STORES.NOTES, currentNote);
      UI.showToast('Note moved to trash 🗑');
      closeEditor();
      NoteApp.refreshNoteList();
    });

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

  // ===== CHECKLIST =====
  function setupChecklist() {
    document.getElementById('addCheckItemBtn')?.addEventListener('click', addChecklistItem);
    document.getElementById('newCheckItem')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') addChecklistItem();
    });

    document.getElementById('checkAllBtn')?.addEventListener('click', () => {
      checklistItems.forEach(item => { item.done = true; });
      renderChecklist();
      triggerAutoSave();
    });

    document.getElementById('uncheckAllBtn')?.addEventListener('click', () => {
      checklistItems.forEach(item => { item.done = false; });
      renderChecklist();
      triggerAutoSave();
    });

    document.getElementById('clearCheckedBtn')?.addEventListener('click', () => {
      checklistItems = checklistItems.filter(item => !item.done);
      renderChecklist();
      triggerAutoSave();
    });
  }

  function addChecklistItem() {
    const input = document.getElementById('newCheckItem');
    const text = input?.value.trim();
    if (!text) return;

    checklistItems.push({ id: Date.now(), text, done: false });
    input.value = '';
    renderChecklist();
    triggerAutoSave();
    input.focus();
  }

  function renderChecklist() {
    const container = document.getElementById('checklistItems');
    if (!container) return;

    const done = checklistItems.filter(i => i.done).length;
    const total = checklistItems.length;

    document.getElementById('progressFill').style.width = total ? `${(done / total) * 100}%` : '0%';
    document.getElementById('progressText').textContent = `${done} / ${total}`;

    container.innerHTML = '';
    checklistItems.forEach((item, index) => {
      const div = document.createElement('div');
      div.className = 'checklist-item';
      div.draggable = true;
      div.dataset.index = index;

      div.innerHTML = `
        <div class="checklist-checkbox ${item.done ? 'checked' : ''}" data-index="${index}"></div>
        <textarea class="checklist-text ${item.done ? 'done' : ''}" data-index="${index}" rows="1">${item.text}</textarea>
        <button class="delete-item-btn" data-index="${index}">✕</button>
      `;

      // Checkbox click
      div.querySelector('.checklist-checkbox').addEventListener('click', () => {
        checklistItems[index].done = !checklistItems[index].done;
        renderChecklist();
        triggerAutoSave();
      });

      // Text edit
      const textarea = div.querySelector('.checklist-text');
      textarea.addEventListener('input', e => {
        checklistItems[index].text = e.target.value;
        autoResize(e.target);
        triggerAutoSave();
      });
      autoResize(textarea);

      // Delete
      div.querySelector('.delete-item-btn').addEventListener('click', () => {
        checklistItems.splice(index, 1);
        renderChecklist();
        triggerAutoSave();
      });

      // Drag & Drop
      div.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', index);
        div.classList.add('dragging');
      });

      div.addEventListener('dragend', () => div.classList.remove('dragging'));

      div.addEventListener('dragover', e => {
        e.preventDefault();
        div.classList.add('drag-over');
      });

      div.addEventListener('dragleave', () => div.classList.remove('drag-over'));

      div.addEventListener('drop', e => {
        e.preventDefault();
        div.classList.remove('drag-over');
        const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
        const toIndex = index;
        if (fromIndex !== toIndex) {
          const moved = checklistItems.splice(fromIndex, 1)[0];
          checklistItems.splice(toIndex, 0, moved);
          renderChecklist();
          triggerAutoSave();
        }
      });

      container.appendChild(div);
    });
  }

  function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  // ===== LOAD NOTE =====
  function loadNote(note) {
    currentNote = note;

    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('editorContent').classList.remove('hidden');

    document.getElementById('titleInput').value = note.title || '';

    const editor = document.getElementById('richEditor');
    editor.innerHTML = note.content || '';

    checklistItems = note.checklist ? JSON.parse(JSON.stringify(note.checklist)) : [];
    renderChecklist();

    updatePinBtn();
    updateFavBtn();
    updateWordCount();
    renderNoteTags();

    // Load strokes if on draw tab
    const drawActive = document.getElementById('drawTabBtn').classList.contains('active');
    if (drawActive) Canvas.loadStrokes(note.strokes || []);
  }

  function renderNoteTags() {
    if (!currentNote) return;
    const display = document.getElementById('noteTagsDisplay');
    display.innerHTML = '';

    (currentNote.tags || []).forEach(tag => {
      const chip = document.createElement('span');
      chip.className = 'note-tag-chip';
      chip.style.background = tag.color;
      chip.textContent = '#' + tag.name;
      display.appendChild(chip);
    });
  }

  function closeEditor() {
    currentNote = null;
    document.getElementById('emptyState').classList.remove('hidden');
    document.getElementById('editorContent').classList.add('hidden');
    document.querySelectorAll('.note-item').forEach(i => i.classList.remove('active'));
  }

  // ===== SAVE =====
  function triggerAutoSave() {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(saveCurrentNote, 3000);
  }

  async function saveCurrentNote() {
    if (!currentNote) return;
    clearTimeout(autoSaveTimer);

    const editor = document.getElementById('richEditor');
    currentNote.content = editor?.innerHTML || '';
    currentNote.title = document.getElementById('titleInput')?.value || 'Untitled';
    currentNote.checklist = JSON.parse(JSON.stringify(checklistItems));
    currentNote.strokes = Canvas.getStrokes();
    currentNote.modifiedAt = Date.now();

    await DB.put(DB.STORES.NOTES, currentNote);
    updateWordCount();

    // Update note list item without full refresh
    NoteApp.updateNoteItem(currentNote);
  }

  function getCurrentNote() { return currentNote; }

  function getChecklistItems() { return checklistItems; }

  function updateNoteTags(tags) {
    if (!currentNote) return;
    currentNote.tags = tags;
    renderNoteTags();
    saveCurrentNote();
  }

  return {
    init, loadNote, saveCurrentNote, closeEditor,
    getCurrentNote, getChecklistItems, updateNoteTags, switchTab
  };
})();
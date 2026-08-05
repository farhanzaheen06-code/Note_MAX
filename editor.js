// ===== EDITOR - Multi-page Support =====
const Editor = (() => {
  let currentNote = null;
  let currentPageIndex = 0;
  let autoSaveTimer = null;

  function init() {
    setupNoteActions();
    setupTitleInput();
    setupPageNavigation();
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

    // Add page button
    document.getElementById('addPageBtn')?.addEventListener('click', addPage);
    document.getElementById('addPageFab')?.addEventListener('click', addPage);
  }

  function setupTitleInput() {
    document.getElementById('titleInput')?.addEventListener('input', e => {
      if (!currentNote) return;
      currentNote.title = e.target.value;
      triggerAutoSave();
    });
  }

  function setupPageNavigation() {
    document.getElementById('prevPageBtn')?.addEventListener('click', () => {
      if (currentPageIndex > 0) {
        savePage();
        currentPageIndex--;
        loadPage();
      }
    });

    document.getElementById('nextPageBtn')?.addEventListener('click', () => {
      if (!currentNote) return;
      if (currentPageIndex < currentNote.pages.length - 1) {
        savePage();
        currentPageIndex++;
        loadPage();
      } else {
        // Auto-add new page when at last page
        addPage();
      }
    });
  }

  async function addPage() {
    if (!currentNote) return;
    savePage();
    const newPage = {
      id: Date.now().toString(),
      strokes: [],
      bgType: Canvas.getBgType()
    };
    currentNote.pages.push(newPage);
    currentPageIndex = currentNote.pages.length - 1;
    loadPage();
    await saveCurrentNote();
    UI.showToast(`Page ${currentPageIndex + 1} added ✨`);
    renderPagesSidebar();
  }

  function loadPage() {
    if (!currentNote || !currentNote.pages) return;
    const page = currentNote.pages[currentPageIndex];
    if (!page) return;
    
    Canvas.loadStrokes(page.strokes || []);
    if (page.bgType) Canvas.setBgType(page.bgType);
    updatePageCounter();
  }

  function savePage() {
    if (!currentNote || !currentNote.pages) return;
    const page = currentNote.pages[currentPageIndex];
    if (!page) return;
    page.strokes = Canvas.getStrokes();
    page.bgType = Canvas.getBgType();
  }

  function updatePageCounter() {
    if (!currentNote) return;
    const counter = document.getElementById('pageCounter');
    if (counter) counter.textContent = `${currentPageIndex + 1} / ${currentNote.pages.length}`;
    
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    if (prevBtn) prevBtn.disabled = currentPageIndex === 0;
    if (nextBtn) nextBtn.disabled = false; // Always enabled (adds page)
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
    // Migrate old notes to page structure
    if (!note.pages) {
      note.pages = [{
        id: Date.now().toString(),
        strokes: note.strokes || [],
        bgType: 'dark'
      }];
      delete note.strokes;
    }
    
    currentNote = note;
    currentPageIndex = 0;
    
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('editorContent').classList.remove('hidden');
    document.getElementById('titleInput').value = note.title || '';
    updatePinBtn();
    updateFavBtn();
    
    setTimeout(() => {
      loadPage();
      renderPagesSidebar();
    }, 50);
  }

  function closeEditor() {
    currentNote = null;
    currentPageIndex = 0;
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
    savePage();
    currentNote.title = document.getElementById('titleInput')?.value || 'Untitled';
    currentNote.modifiedAt = Date.now();
    await DB.put(DB.STORES.NOTES, currentNote);
    NoteApp.updateNoteItem(currentNote);
  }

  function renderPagesSidebar() {
    const container = document.getElementById('pagesContainer');
    if (!container || !currentNote) return;
    container.innerHTML = '';
    
    currentNote.pages.forEach((page, index) => {
      const thumb = document.createElement('div');
      thumb.className = 'page-thumb' + (index === currentPageIndex ? ' active' : '');
      thumb.dataset.index = index;
      
      // Generate thumbnail from strokes
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.className = 'page-thumb-canvas';
      thumbCanvas.width = 150;
      thumbCanvas.height = 200;
      const tCtx = thumbCanvas.getContext('2d');
      
      // Background
      tCtx.fillStyle = page.bgType === 'white' ? '#ffffff' : 
                        page.bgType === 'cream' ? '#fff9e6' : '#0a0a0a';
      tCtx.fillRect(0, 0, 150, 200);
      
      // Draw scaled strokes
      const scaleX = 150 / (window.innerWidth || 1024);
      const scaleY = 200 / (window.innerHeight || 768);
      const scale = Math.min(scaleX, scaleY);
      
      (page.strokes || []).forEach(stroke => {
        if (stroke.points.length < 1) return;
        tCtx.strokeStyle = stroke.color;
        tCtx.fillStyle = stroke.color;
        tCtx.lineWidth = Math.max(0.5, stroke.size * scale);
        tCtx.lineCap = 'round';
        tCtx.globalAlpha = stroke.tool === 'highlighter' ? 0.3 : (stroke.opacity || 1);
        
        if (stroke.points.length === 1) {
          tCtx.beginPath();
          tCtx.arc(stroke.points[0].x * scale, stroke.points[0].y * scale, stroke.size * scale / 2, 0, Math.PI * 2);
          tCtx.fill();
        } else {
          tCtx.beginPath();
          tCtx.moveTo(stroke.points[0].x * scale, stroke.points[0].y * scale);
          for (let i = 1; i < stroke.points.length; i++) {
            tCtx.lineTo(stroke.points[i].x * scale, stroke.points[i].y * scale);
          }
          tCtx.stroke();
        }
      });
      
      thumb.appendChild(thumbCanvas);
      
      const label = document.createElement('div');
      label.className = 'page-thumb-label';
      label.textContent = `Page ${index + 1}`;
      thumb.appendChild(label);
      
      const del = document.createElement('button');
      del.className = 'page-thumb-delete';
      del.textContent = '✕';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deletePage(index);
      });
      thumb.appendChild(del);
      
      thumb.addEventListener('click', () => {
        if (index !== currentPageIndex) {
          savePage();
          currentPageIndex = index;
          loadPage();
          renderPagesSidebar();
        }
      });
      
      container.appendChild(thumb);
    });
  }

  async function deletePage(index) {
    if (!currentNote || currentNote.pages.length <= 1) {
      UI.showToast('Cannot delete last page');
      return;
    }
    if (!confirm(`Delete page ${index + 1}?`)) return;
    
    currentNote.pages.splice(index, 1);
    if (currentPageIndex >= currentNote.pages.length) {
      currentPageIndex = currentNote.pages.length - 1;
    }
    loadPage();
    renderPagesSidebar();
    await saveCurrentNote();
    UI.showToast('Page deleted');
  }

  function getCurrentNote() { return currentNote; }
  function getCurrentPageIndex() { return currentPageIndex; }
  function refreshPagesSidebar() { renderPagesSidebar(); }

  // Auto-save every 3 seconds
  setInterval(() => {
    if (currentNote) saveCurrentNote();
  }, 3000);

  return {
    init, loadNote, saveCurrentNote, closeEditor,
    getCurrentNote, getCurrentPageIndex,
    addPage, refreshPagesSidebar, updatePageCounter
  };
})();

import React, { useState, useEffect, useMemo } from 'react';
import {
  FolderPlus,
  BookOpen,
  Plus,
  Trash2,
  ChevronDown,
  Layers,
  ArrowUp,
  ArrowDown,
  X,
  Check,
  AlertTriangle,
  GripVertical,
} from 'lucide-react';
import { useStudioStore } from '../../store/useStudioStore';
import {
  useProjects,
  useChapters,
  usePages,
} from '../../db/hooks';
import {
  createProject,
  deleteProject,
  createChapter,
  deleteChapter,
  deletePage,
  reorderPages,
} from '../../db/importExport';
import { Page, PageStatus } from '../../types/project';
import { FileUploader } from '../common/FileUploader';

// Component for individual page thumbnail card with blob URL lifecycle management
const ThumbnailItem: React.FC<{
  page: Page;
  isActive: boolean;
  index: number;
  total: number;
  onSelect: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}> = ({
  page,
  isActive,
  index,
  total,
  onSelect,
  onDelete,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDrop,
}) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    if (page.sourceBlob) {
      try {
        url = URL.createObjectURL(page.sourceBlob);
        setObjectUrl(url);
      } catch {
        setObjectUrl(null);
      }
    }
    return () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [page.sourceBlob]);

  const getStatusBadge = (status: PageStatus) => {
    switch (status) {
      case 'idle':
        return (
          <span
            data-testid={`page-status-${page.id}`}
            className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700"
          >
            Idle
          </span>
        );
      case 'processing':
        return (
          <span
            data-testid={`page-status-${page.id}`}
            className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800 animate-pulse"
          >
            Processing
          </span>
        );
      case 'ocr_completed':
        return (
          <span
            data-testid={`page-status-${page.id}`}
            className="text-[10px] px-1.5 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-800"
          >
            OCR Done
          </span>
        );
      case 'translated':
        return (
          <span
            data-testid={`page-status-${page.id}`}
            className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800"
          >
            Translated
          </span>
        );
      case 'error':
        return (
          <span
            data-testid={`page-status-${page.id}`}
            className="text-[10px] px-1.5 py-0.5 rounded bg-red-950/80 text-red-300 border border-red-800"
          >
            Error
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div
      data-testid={`thumbnail-card-${page.id}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onSelect}
      className={`group relative flex flex-col p-2 rounded border cursor-pointer transition-all duration-150 ${
        isActive
          ? 'bg-primary/10 border-primary shadow-sm shadow-primary/20 ring-1 ring-primary/40'
          : 'bg-card/60 border-border hover:border-slate-600 hover:bg-card'
      }`}
    >
      {/* Header with page number & actions */}
      <div className="flex items-center justify-between mb-1.5 text-xs">
        <div className="flex items-center gap-1.5">
          <GripVertical className="w-3.5 h-3.5 text-muted/60 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing" />
          <span className="font-semibold text-slate-200">#{page.pageNumber}</span>
          <span className="text-[10px] text-muted truncate max-w-[80px]" title={page.fileName}>
            {page.fileName}
          </span>
        </div>

        <div className="flex items-center gap-0.5">
          {getStatusBadge(page.status)}

          <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity ml-1">
            <button
              type="button"
              disabled={index === 0}
              onClick={(e) => {
                e.stopPropagation();
                onMoveUp();
              }}
              title="Move page up"
              className="p-0.5 text-muted hover:text-text disabled:opacity-20"
            >
              <ArrowUp className="w-3 h-3" />
            </button>
            <button
              type="button"
              disabled={index === total - 1}
              onClick={(e) => {
                e.stopPropagation();
                onMoveDown();
              }}
              title="Move page down"
              className="p-0.5 text-muted hover:text-text disabled:opacity-20"
            >
              <ArrowDown className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Delete page #${page.pageNumber}?`)) {
                  onDelete();
                }
              }}
              title="Delete page"
              className="p-0.5 text-muted hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Thumbnail preview container */}
      <div className="relative aspect-[3/4] w-full bg-background rounded overflow-hidden flex items-center justify-center border border-border/80">
        {objectUrl ? (
          <img
            src={objectUrl}
            alt={`Page ${page.pageNumber}`}
            className="w-full h-full object-contain pointer-events-none"
            loading="lazy"
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-muted text-[10px]">
            <BookOpen className="w-5 h-5 mb-1 opacity-50" />
            <span>Loading...</span>
          </div>
        )}

        {/* Resolution tag */}
        <span className="absolute bottom-1 right-1 bg-black/70 px-1 py-0.5 rounded text-[9px] font-mono text-slate-300">
          {page.width}x{page.height}
        </span>
      </div>
    </div>
  );
};

export const ProjectSidebar: React.FC = () => {
  const {
    activeProjectId,
    activeChapterId,
    activePageId,
    setActiveProject,
    setActiveChapter,
    setActivePage,
    isSidebarOpen,
  } = useStudioStore();

  const projects = useProjects();
  const chapters = useChapters(activeProjectId);
  const pages = usePages(activeChapterId);

  // Modal & form states
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectSrcLang, setNewProjectSrcLang] = useState('ja');
  const [newProjectTgtLang, setNewProjectTgtLang] = useState('vi');

  const [isNewChapterModalOpen, setIsNewChapterModalOpen] = useState(false);
  const [newChapterTitle, setNewChapterTitle] = useState('');

  // Drag-and-drop reorder state
  const [draggedPageId, setDraggedPageId] = useState<string | null>(null);

  // Automatically select first project/chapter if none selected
  useEffect(() => {
    if (!activeProjectId && projects && projects.length > 0) {
      setActiveProject(projects[0].id);
    }
  }, [activeProjectId, projects, setActiveProject]);

  useEffect(() => {
    if (activeProjectId && (!activeChapterId || !chapters?.some((c) => c.id === activeChapterId))) {
      if (chapters && chapters.length > 0) {
        setActiveChapter(chapters[0].id);
      }
    }
  }, [activeProjectId, activeChapterId, chapters, setActiveChapter]);

  useEffect(() => {
    if (activeChapterId && (!activePageId || !pages?.some((p) => p.id === activePageId))) {
      if (pages && pages.length > 0) {
        setActivePage(pages[0].id);
      }
    }
  }, [activeChapterId, activePageId, pages, setActivePage]);

  const activeProject = useMemo(
    () => projects?.find((p) => p.id === activeProjectId),
    [projects, activeProjectId]
  );

  const activeChapter = useMemo(
    () => chapters?.find((c) => c.id === activeChapterId),
    [chapters, activeChapterId]
  );

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;

    try {
      const created = await createProject({
        name: newProjectName.trim(),
        sourceLanguage: newProjectSrcLang,
        targetLanguage: newProjectTgtLang,
      });
      // Automatically create Chapter 1
      const firstChapter = await createChapter(created.id, 'Chapter 1', 1);
      setActiveProject(created.id);
      setActiveChapter(firstChapter.id);

      setNewProjectName('');
      setIsNewProjectModalOpen(false);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleCreateChapter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProjectId) return;

    try {
      const created = await createChapter(
        activeProjectId,
        newChapterTitle.trim() || undefined
      );
      setActiveChapter(created.id);
      setNewChapterTitle('');
      setIsNewChapterModalOpen(false);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    if (window.confirm('Are you sure you want to delete this project and all its chapters & pages?')) {
      await deleteProject(projectId);
      if (activeProjectId === projectId) {
        setActiveProject(null);
      }
    }
  };

  const handleDeleteChapter = async (chapterId: string) => {
    if (window.confirm('Delete this chapter and all its pages?')) {
      await deleteChapter(chapterId);
      if (activeChapterId === chapterId) {
        setActiveChapter(null);
      }
    }
  };

  // Page reordering logic
  const handleMovePage = async (pageIndex: number, direction: 'up' | 'down') => {
    if (!pages || !activeChapterId) return;
    const targetIndex = direction === 'up' ? pageIndex - 1 : pageIndex + 1;
    if (targetIndex < 0 || targetIndex >= pages.length) return;

    const pageIds = pages.map((p) => p.id);
    const temp = pageIds[pageIndex];
    pageIds[pageIndex] = pageIds[targetIndex];
    pageIds[targetIndex] = temp;

    await reorderPages(activeChapterId, pageIds);
  };

  const handleDragStart = (pageId: string) => (e: React.DragEvent) => {
    setDraggedPageId(pageId);
    e.dataTransfer.setData('text/plain', pageId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDropOnPage = (targetPageId: string) => async (e: React.DragEvent) => {
    e.preventDefault();
    const sourceId = draggedPageId || e.dataTransfer.getData('text/plain');
    if (!sourceId || sourceId === targetPageId || !pages || !activeChapterId) {
      setDraggedPageId(null);
      return;
    }

    const currentIds = pages.map((p) => p.id);
    const sourceIndex = currentIds.indexOf(sourceId);
    const targetIndex = currentIds.indexOf(targetPageId);

    if (sourceIndex === -1 || targetIndex === -1) {
      setDraggedPageId(null);
      return;
    }

    // Move source to target position
    currentIds.splice(sourceIndex, 1);
    currentIds.splice(targetIndex, 0, sourceId);

    await reorderPages(activeChapterId, currentIds);
    setDraggedPageId(null);
  };

  if (!isSidebarOpen) {
    return null;
  }

  return (
    <aside
      data-testid="project-sidebar"
      className="w-72 h-full bg-sidebar border-r border-border flex flex-col z-20 select-none text-text"
      style={{ backgroundColor: '#141518', borderColor: '#272930' }}
    >
      {/* 1. Project Selector Section */}
      <div className="p-3 border-b border-border bg-card/40">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">
            Project
          </span>
          <button
            type="button"
            data-testid="new-project-btn"
            onClick={() => setIsNewProjectModalOpen(true)}
            className="flex items-center gap-1 text-xs text-primary hover:text-blue-400 font-medium transition-colors"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>New</span>
          </button>
        </div>

        {projects && projects.length > 0 ? (
          <div className="flex items-center justify-between bg-background border border-border rounded px-2.5 py-1.5">
            <select
              data-testid="project-select"
              value={activeProjectId || ''}
              onChange={(e) => setActiveProject(e.target.value)}
              className="bg-transparent text-sm font-medium text-slate-200 outline-none w-full cursor-pointer"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id} className="bg-card text-text">
                  {p.name}
                </option>
              ))}
            </select>
            {activeProjectId && (
              <button
                type="button"
                data-testid="delete-project-btn"
                onClick={() => handleDeleteProject(activeProjectId)}
                title="Delete current project"
                className="text-muted hover:text-red-400 p-1 ml-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted py-1">No projects yet. Create one to begin!</div>
        )}
      </div>

      {/* 2. Chapter Selector / Tabs Section */}
      {activeProjectId && (
        <div className="p-3 border-b border-border bg-card/20">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">
              Chapters
            </span>
            <button
              type="button"
              data-testid="new-chapter-btn"
              onClick={() => setIsNewChapterModalOpen(true)}
              className="flex items-center gap-1 text-xs text-primary hover:text-blue-400 font-medium transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </div>

          <div
            data-testid="chapter-tabs"
            className="flex items-center gap-1.5 overflow-x-auto pb-1"
          >
            {chapters && chapters.length > 0 ? (
              chapters.map((chap) => (
                <div
                  key={chap.id}
                  className={`group flex items-center gap-1 px-2.5 py-1 rounded text-xs whitespace-nowrap cursor-pointer transition-colors ${
                    activeChapterId === chap.id
                      ? 'bg-primary text-white font-medium'
                      : 'bg-card text-muted hover:text-text hover:bg-card/80 border border-border'
                  }`}
                  onClick={() => setActiveChapter(chap.id)}
                >
                  <span>{chap.title}</span>
                  {chapters.length > 1 && (
                    <button
                      type="button"
                      data-testid={`delete-chapter-${chap.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteChapter(chap.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-300 ml-0.5"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))
            ) : (
              <div className="text-xs text-muted">No chapters</div>
            )}
          </div>
        </div>
      )}

      {/* 3. Page Thumbnail Strip Section */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="p-3 pb-2 flex items-center justify-between border-b border-border/50">
          <div className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-muted" />
            <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">
              Pages ({pages?.length || 0})
            </span>
          </div>

          {activeChapterId && (
            <FileUploader
              chapterId={activeChapterId}
              compact
              onUploadComplete={(newPages) => {
                if (newPages.length > 0 && !activePageId) {
                  setActivePage(newPages[0].id);
                }
              }}
            />
          )}
        </div>

        {/* Scrollable thumbnail strip */}
        <div
          data-testid="thumbnail-strip"
          className="flex-1 overflow-y-auto p-3 space-y-2.5"
        >
          {pages && pages.length > 0 ? (
            pages.map((page, index) => (
              <ThumbnailItem
                key={page.id}
                page={page}
                isActive={activePageId === page.id}
                index={index}
                total={pages.length}
                onSelect={() => setActivePage(page.id)}
                onDelete={() => deletePage(page.id)}
                onMoveUp={() => handleMovePage(index, 'up')}
                onMoveDown={() => handleMovePage(index, 'down')}
                onDragStart={handleDragStart(page.id)}
                onDragOver={handleDragOver}
                onDrop={handleDropOnPage(page.id)}
              />
            ))
          ) : (
            <div className="flex flex-col items-center justify-center p-6 text-center text-muted">
              {activeChapterId ? (
                <FileUploader
                  chapterId={activeChapterId}
                  className="w-full"
                  onUploadComplete={(newPages) => {
                    if (newPages.length > 0) {
                      setActivePage(newPages[0].id);
                    }
                  }}
                />
              ) : (
                <p className="text-xs">Select or create a chapter to upload pages.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal: New Project */}
      {isNewProjectModalOpen && (
        <div
          data-testid="new-project-modal"
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
        >
          <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-sm p-5 space-y-4 text-text">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm text-slate-100">Create New Project</h3>
              <button
                type="button"
                onClick={() => setIsNewProjectModalOpen(false)}
                className="text-muted hover:text-text"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Project Title
                </label>
                <input
                  type="text"
                  data-testid="new-project-name-input"
                  required
                  placeholder="e.g. Solo Leveling Ch. 1"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-background border border-border rounded text-sm text-text focus:outline-none focus:border-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Source Language
                  </label>
                  <select
                    value={newProjectSrcLang}
                    onChange={(e) => setNewProjectSrcLang(e.target.value)}
                    className="w-full px-2 py-1.5 bg-background border border-border rounded text-xs text-text focus:outline-none"
                  >
                    <option value="ja">Japanese (日本語)</option>
                    <option value="ko">Korean (한국어)</option>
                    <option value="zh">Chinese (中文)</option>
                    <option value="en">English</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Target Language
                  </label>
                  <select
                    value={newProjectTgtLang}
                    onChange={(e) => setNewProjectTgtLang(e.target.value)}
                    className="w-full px-2 py-1.5 bg-background border border-border rounded text-xs text-text focus:outline-none"
                  >
                    <option value="vi">Vietnamese (Tiếng Việt)</option>
                    <option value="en">English</option>
                    <option value="es">Spanish</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsNewProjectModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-muted hover:text-text rounded border border-border"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="create-project-submit"
                  className="px-3 py-1.5 text-xs bg-primary hover:bg-blue-600 text-white font-medium rounded transition-colors"
                >
                  Create Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: New Chapter */}
      {isNewChapterModalOpen && (
        <div
          data-testid="new-chapter-modal"
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
        >
          <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-sm p-5 space-y-4 text-text">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm text-slate-100">Add New Chapter</h3>
              <button
                type="button"
                onClick={() => setIsNewChapterModalOpen(false)}
                className="text-muted hover:text-text"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateChapter} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Chapter Title
                </label>
                <input
                  type="text"
                  data-testid="new-chapter-title-input"
                  placeholder="e.g. Chapter 2"
                  value={newChapterTitle}
                  onChange={(e) => setNewChapterTitle(e.target.value)}
                  className="w-full px-3 py-1.5 bg-background border border-border rounded text-sm text-text focus:outline-none focus:border-primary"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsNewChapterModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-muted hover:text-text rounded border border-border"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="create-chapter-submit"
                  className="px-3 py-1.5 text-xs bg-primary hover:bg-blue-600 text-white font-medium rounded transition-colors"
                >
                  Add Chapter
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </aside>
  );
};

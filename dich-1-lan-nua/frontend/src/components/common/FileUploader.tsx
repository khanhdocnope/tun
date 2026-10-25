import React, { useState, useRef, DragEvent, ChangeEvent } from 'react';
import { UploadCloud, Image as ImageIcon, FileArchive, Loader2, AlertCircle } from 'lucide-react';
import { importFiles } from '../../db/importExport';
import { Page } from '../../types/project';

export interface FileUploaderProps {
  chapterId: string;
  onUploadStart?: () => void;
  onUploadComplete?: (pages: Page[]) => void;
  onError?: (error: Error) => void;
  className?: string;
  compact?: boolean;
}

export const FileUploader: React.FC<FileUploaderProps> = ({
  chapterId,
  onUploadStart,
  onUploadComplete,
  onError,
  className = '',
  compact = false,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const processFiles = async (fileList: FileList | File[]) => {
    if (!fileList || fileList.length === 0) return;
    if (!chapterId) {
      const err = new Error('No active chapter selected for import');
      setErrorMessage(err.message);
      onError?.(err);
      return;
    }

    const files = Array.from(fileList);
    setIsUploading(true);
    setErrorMessage(null);
    setStatusMessage(`Importing ${files.length} file(s)...`);
    onUploadStart?.();

    try {
      const pages = await importFiles(chapterId, files);
      setStatusMessage(`Successfully imported ${pages.length} page(s)`);
      onUploadComplete?.(pages);
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err: any) {
      const error = err instanceof Error ? err : new Error(String(err));
      setErrorMessage(error.message);
      onError?.(error);
    } finally {
      setIsUploading(false);
      setIsDragging(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer?.files) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(e.target.files);
    }
  };

  const handleClick = () => {
    if (!isUploading) {
      fileInputRef.current?.click();
    }
  };

  if (compact) {
    return (
      <div className={`relative ${className}`}>
        <input
          ref={fileInputRef}
          type="file"
          data-testid="file-uploader-input"
          accept=".png,.jpg,.jpeg,.webp,.zip"
          multiple
          onChange={handleFileChange}
          className="hidden"
          disabled={isUploading}
        />
        <button
          type="button"
          data-testid="file-uploader-button"
          onClick={handleClick}
          disabled={isUploading}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-primary hover:bg-blue-600 text-white rounded transition-colors disabled:opacity-50"
        >
          {isUploading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <UploadCloud className="w-3.5 h-3.5" />
          )}
          <span>{isUploading ? 'Importing...' : 'Import Pages'}</span>
        </button>
        {errorMessage && (
          <p className="mt-1 text-xs text-red-400 truncate" title={errorMessage}>
            {errorMessage}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="file-uploader-dropzone"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all duration-200 ${
        isDragging
          ? 'border-primary bg-primary/10 scale-[1.01]'
          : 'border-border bg-card hover:border-gray-500 hover:bg-card/80'
      } ${isUploading ? 'pointer-events-none opacity-75' : ''} ${className}`}
    >
      <input
        ref={fileInputRef}
        type="file"
        data-testid="file-uploader-input"
        accept=".png,.jpg,.jpeg,.webp,.zip"
        multiple
        onChange={handleFileChange}
        className="hidden"
        disabled={isUploading}
      />

      <div className="flex flex-col items-center justify-center space-y-3">
        {isUploading ? (
          <Loader2 className="w-10 h-10 text-primary animate-spin" />
        ) : (
          <div className="flex items-center gap-2 text-muted">
            <ImageIcon className="w-6 h-6 text-blue-400" />
            <UploadCloud className="w-8 h-8 text-primary" />
            <FileArchive className="w-6 h-6 text-yellow-500" />
          </div>
        )}

        <div className="space-y-1">
          <p className="text-sm font-medium text-text">
            {isUploading ? 'Processing & saving pages...' : 'Drag & drop comic pages or ZIP archive'}
          </p>
          <p className="text-xs text-muted">
            Supports PNG, JPEG, WebP images or .ZIP containing comic scans
          </p>
        </div>

        {statusMessage && (
          <p className="text-xs text-green-400 font-medium">{statusMessage}</p>
        )}

        {errorMessage && (
          <div className="flex items-center gap-1.5 text-xs text-red-400 font-medium">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
};

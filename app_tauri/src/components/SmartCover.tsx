import React, { useState, useEffect } from 'react';
import { BookOpen } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface SmartCoverProps {
  url: string;
  title: string;
  source: string;
  className?: string;
  fallbackIconSize?: number;
}

export const SmartCover: React.FC<SmartCoverProps> = ({
  url,
  title,
  source,
  className = 'w-full h-full object-cover',
  fallbackIconSize = 30,
}) => {
  const isAntiHotlink =
    source === 'hitomi' ||
    url.includes('gold-usergeneratedcontent.net') ||
    url.includes('hitomi.la');

  const [imgSrc, setImgSrc] = useState<string>(isAntiHotlink ? '' : url);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!url) {
      setImgSrc('');
      setLoaded(false);
      setFailed(true);
      return;
    }

    if (isAntiHotlink) {
      setLoaded(false);
      setFailed(false);
      invoke<string>('get_image_base64', { url, source: 'hitomi' })
        .then((b64) => {
          if (!cancelled) {
            setImgSrc(b64);
            setLoaded(true);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setFailed(true);
          }
        });
    } else {
      setImgSrc(url);
      setLoaded(false);
      setFailed(false);
    }

    return () => {
      cancelled = true;
    };
  }, [url, source, isAntiHotlink]);

  const handleDirectError = () => {
    if (!imgSrc.startsWith('data:') && url) {
      invoke<string>('get_image_base64', { url, source })
        .then((b64) => {
          setImgSrc(b64);
          setLoaded(true);
        })
        .catch(() => {
          setFailed(true);
        });
    } else {
      setFailed(true);
    }
  };

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Placeholder icon in background */}
      <div className="absolute inset-0 grid place-items-center text-slate-600">
        <BookOpen size={fallbackIconSize} />
      </div>

      {imgSrc && !failed && (
        <img
          src={imgSrc}
          alt={title}
          loading="lazy"
          className={`absolute inset-0 transition-opacity duration-200 ${className} ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
          onLoad={() => setLoaded(true)}
          onError={handleDirectError}
        />
      )}
    </div>
  );
};

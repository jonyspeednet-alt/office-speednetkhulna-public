import React, { useState, useEffect } from 'react';
import { buildAvatarDataUri, buildImagePlaceholderDataUri } from '../utils/imagePaths';

const ImageWithFallback = ({ 
  src, 
  alt, 
  fallbackSrc, 
  fallbackName, 
  className, 
  style, 
  width, 
  height,
  type = 'profile' // 'profile' or 'nid' or 'other'
}) => {
  const [imgSrc, setImgSrc] = useState(src);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    setImgSrc(src);
    setIsError(false);
  }, [src]);

  const handleError = () => {
    if (isError) return; // Prevent infinite loop if fallback also fails

    setIsError(true);
    
    if (fallbackSrc) {
      setImgSrc(fallbackSrc);
    } else if (fallbackName) {
      setImgSrc(buildAvatarDataUri(fallbackName));
    } else {
      // Default placeholder based on type
      if (type === 'profile') {
        setImgSrc(buildAvatarDataUri('User'));
      } else {
        setImgSrc(buildImagePlaceholderDataUri('No Image'));
      }
    }
  };

  const defaultStyle = {
    objectFit: 'cover',
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...style
  };

  return (
    <img
      src={imgSrc || (fallbackName ? buildAvatarDataUri(fallbackName) : buildImagePlaceholderDataUri('No Image'))}
      alt={alt}
      className={className}
      style={defaultStyle}
      onError={handleError}
    />
  );
};

export default ImageWithFallback;

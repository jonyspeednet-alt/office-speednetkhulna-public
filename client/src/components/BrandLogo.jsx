import React, { useEffect, useState } from 'react';
import { BRAND_LOGO_FALLBACK_URL, BRAND_LOGO_LOCAL_URL, BRAND_LOGO_URL } from '../utils/imagePaths';

const BrandLogo = ({ src, alt = 'Speed Net Khulna', className, style }) => {
  const primarySrc = src || BRAND_LOGO_URL;
  const [imgSrc, setImgSrc] = useState(primarySrc);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setImgSrc(primarySrc);
    setAttempt(0);
  }, [primarySrc]);

  const handleError = () => {
    if (attempt === 0) {
      setImgSrc(BRAND_LOGO_LOCAL_URL);
      setAttempt(1);
      return;
    }
    if (attempt === 1) {
      setImgSrc(BRAND_LOGO_FALLBACK_URL);
      setAttempt(2);
      return;
    }
  };

  return (
    <img
      src={imgSrc || BRAND_LOGO_FALLBACK_URL}
      alt={alt}
      className={className}
      style={style}
      onError={handleError}
    />
  );
};

export default BrandLogo;

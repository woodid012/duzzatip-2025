'use client'

import Image from 'next/image';
import logo from '@/app/assets/logo.png';

export const Logo = ({ width = 150, height = 50, alt = "Company Logo", className = "" }) => {
  return (
    <Image 
      src={logo}
      alt={alt}
      width={width}
      height={height}
      className={`object-contain ${className}`}
      priority
    />
  );
};

export default Logo;
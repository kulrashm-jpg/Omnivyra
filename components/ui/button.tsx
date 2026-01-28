import React from 'react';

interface ButtonProps {
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  disabled?: boolean;
}

export const Button: React.FC<ButtonProps> = ({ 
  className = '', 
  children, 
  onClick,
  type = 'button',
  variant = 'default',
  size = 'default',
  disabled = false
}) => {
  const baseClasses = 'inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';
  
  const variantClasses = {
    default: 'bg-slate-900 text-slate-50 hover:bg-slate-900/90',
    destructive: 'bg-red-500 text-slate-50 hover:bg-red-500/90',
    outline: 'border border-slate-200 bg-white hover:bg-slate-100 hover:text-slate-900',
    secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-100/80',
    ghost: 'hover:bg-slate-100 hover:text-slate-900',
    link: 'text-slate-900 underline-offset-4 hover:underline'
  };
  
  const sizeClasses = {
    default: 'h-10 px-4 py-2',
    sm: 'h-9 rounded-md px-3',
    lg: 'h-11 rounded-md px-8',
    icon: 'h-10 w-10'
  };
  
  const classes = `${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`;
  
  return (
    <button
      type={type}
      className={classes}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
};
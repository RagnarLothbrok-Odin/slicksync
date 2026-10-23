'use client';

import { useState, useRef, useEffect } from 'react';
import { PencilIcon } from '@heroicons/react/24/outline';

interface InlineEditProps {
  value: string | undefined;
  onSave: (newValue: string) => Promise<void>;
  placeholder?: string;
  className?: string;
  maxLength?: number;
  disabled?: boolean;
}

export function InlineEdit({
  value,
  onSave,
  placeholder = 'Enter value...',
  className = '',
  maxLength,
  disabled = false,
}: InlineEditProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelledRef = useRef(false);
  const savingRef = useRef(false);
  const restoreFocusRef = useRef(false);

  useEffect(() => {
    if (!isEditing && restoreFocusRef.current) {
      triggerRef.current?.focus();
      restoreFocusRef.current = false;
    }
  }, [isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      const length = inputRef.current.value.length;
      inputRef.current.setSelectionRange(length, length);
    }
  }, [isEditing]);

  useEffect(() => {
    setEditValue(value || '');
  }, [value]);

  const handleStartEdit = () => {
    if (disabled) return;
    cancelledRef.current = false;
    setIsEditing(true);
    setEditValue(value || '');
  };

  const handleCancel = () => {
    cancelledRef.current = true;
    setIsEditing(false);
    setEditValue(value || '');
  };

  const handleSave = async () => {
    if (cancelledRef.current || savingRef.current) return;
    const currentVal = editValue || '';
    const originalVal = value || '';
    
    if (currentVal.trim() === originalVal.trim() || !currentVal.trim()) {
      handleCancel();
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    try {
      await onSave(currentVal.trim());
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      restoreFocusRef.current = true;
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      restoreFocusRef.current = true;
      e.preventDefault();
      handleCancel();
    }
  };

  const handleBlur = () => {
    handleSave();
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        aria-label={placeholder}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={isSaving}
        className={`bg-transparent border-b-2 border-primary outline-none focus:ring-0 p-0 m-0 text-inherit font-inherit w-full min-w-[100px] ${isSaving ? 'opacity-50' : ''} ${className}`}
      />
    );
  }

  return (
    <button
      ref={triggerRef}
      type="button"
      disabled={disabled}
      aria-label={`Edit ${value || placeholder}`}
      onClick={handleStartEdit}
      className={`text-left flex items-center gap-2 cursor-pointer group rounded px-1 -ml-1 hover:bg-surface-hover transition-colors ${disabled ? 'cursor-default' : ''} ${className}`}
      title={disabled ? '' : 'Click to edit'}
    >
      <span className="text-inherit font-inherit truncate max-w-full">
        {value || placeholder || 'Click to edit'}
      </span>
      {!disabled && (
        <PencilIcon className="w-4 h-4 text-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity shrink-0" />
      )}
    </button>
  );
}

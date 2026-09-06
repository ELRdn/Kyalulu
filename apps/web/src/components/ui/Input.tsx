import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import "./ui.css";

export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`k-input ${className}`} {...rest} />;
}

export function Textarea({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`k-textarea ${className}`} {...rest} />;
}

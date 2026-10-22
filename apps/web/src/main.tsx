import React from 'react';
import { createRoot } from 'react-dom/client';
import { Table } from './table';
import './style.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><Table /></React.StrictMode>);

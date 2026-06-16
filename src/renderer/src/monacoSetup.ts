import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

// Use locally bundled Monaco instead of CDN
loader.config({ monaco })

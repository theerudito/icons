/// <reference types="vite/client" />

interface Window {
  go?: {
    main?: {
      App?: {
        SaveFile?: (filename: string, encodedData: string) => Promise<string>
      }
    }
  }
}

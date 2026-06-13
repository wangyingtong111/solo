import { useState, useCallback } from 'react';
import { Editor } from './components/Editor';
import { WelcomeModal } from './components/WelcomeModal';

function App() {
  const [showWelcome, setShowWelcome] = useState(true);
  const [initialFile, setInitialFile] = useState<File | null>(null);

  const handleFileSelect = useCallback((file: File) => {
    setInitialFile(file);
    setShowWelcome(false);
  }, []);

  const handleCreateNew = useCallback((width: number, height: number) => {
    setShowWelcome(false);
  }, []);

  return (
    <div className="w-full h-full bg-dark-600 text-white">
      {showWelcome && (
        <WelcomeModal
          onFileSelect={handleFileSelect}
          onCreateNew={handleCreateNew}
        />
      )}
      <Editor initialFile={initialFile} />
    </div>
  );
}

export default App;

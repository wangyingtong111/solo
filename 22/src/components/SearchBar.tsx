import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { Cluster } from '../types';
import { useAppStore } from '../store/useAppStore';
import { fuzzySearchClusters, highlightMatch } from '../utils/fuzzySearch';

interface SearchBarProps {
  clusters: Cluster[];
  onSelect: (cluster: Cluster) => void;
}

export const SearchBar = ({ clusters, onSelect }: SearchBarProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [localQuery, setLocalQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const searchQuery = useAppStore(state => state.searchQuery);
  const searchResults = useAppStore(state => state.searchResults);
  const setSearchQuery = useAppStore(state => state.setSearchQuery);
  const setSearchResults = useAppStore(state => state.setSearchResults);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && !isOpen && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
        setLocalQuery('');
        setSearchQuery('');
        setSearchResults([]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, setSearchQuery, setSearchResults]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setLocalQuery(value);
    setSearchQuery(value);
    setSelectedIndex(0);

    if (value.trim()) {
      const results = fuzzySearchClusters(clusters, value);
      setSearchResults(results);
    } else {
      setSearchResults([]);
    }

    setIsOpen(value.length > 0);
  }, [clusters, setSearchQuery, setSearchResults]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || searchResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % searchResults.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + searchResults.length) % searchResults.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (searchResults[selectedIndex]) {
        handleSelect(searchResults[selectedIndex]);
      }
    }
  };

  const handleSelect = (cluster: Cluster) => {
    onSelect(cluster);
    setIsOpen(false);
    setLocalQuery('');
    setSearchQuery('');
    setSearchResults([]);
  };

  const clearSearch = () => {
    setLocalQuery('');
    setSearchQuery('');
    setSearchResults([]);
    setIsOpen(false);
    inputRef.current?.blur();
  };

  const clusterColorStyle = (cluster: Cluster) => ({
    backgroundColor: `rgb(${cluster.color[0] * 255}, ${cluster.color[1] * 255}, ${cluster.color[2] * 255})`,
  });

  return (
    <div ref={containerRef} className="fixed top-4 right-4 z-10 w-80">
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={localQuery}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => localQuery && setIsOpen(true)}
            placeholder="搜索聚类标签... (按 / 聚焦)"
            className="w-full bg-transparent pl-10 pr-10 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          {localQuery && (
            <button
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4 text-gray-400 hover:text-white" />
            </button>
          )}
        </div>

        {isOpen && searchResults.length > 0 && (
          <div className="border-t border-white/10 max-h-64 overflow-y-auto">
            {searchResults.map((cluster, index) => (
              <button
                key={cluster.id}
                onClick={() => handleSelect(cluster)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  index === selectedIndex
                    ? 'bg-accent/20 text-white'
                    : 'hover:bg-white/5 text-gray-300'
                }`}
              >
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={clusterColorStyle(cluster)}
                />
                <div className="flex-1 min-w-0">
                  <div
                    className="text-sm font-medium truncate"
                    dangerouslySetInnerHTML={{
                      __html: highlightMatch(cluster.name, localQuery),
                    }}
                  />
                  <div className="text-xs text-gray-500 font-mono">
                    {cluster.pointCount.toLocaleString()} 个点
                  </div>
                </div>
                {index === selectedIndex && (
                  <span className="text-xs text-accent font-mono">Enter ↵</span>
                )}
              </button>
            ))}
          </div>
        )}

        {isOpen && searchResults.length === 0 && localQuery && (
          <div className="border-t border-white/10 px-4 py-3 text-center text-sm text-gray-500">
            未找到匹配的聚类
          </div>
        )}
      </div>
    </div>
  );
};

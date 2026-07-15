import React, { useState, useEffect, useRef } from "react";
import { generateMCQ } from "../utils/api";
import "./MCQModal.css";

const ALPHABET = ["A", "B", "C", "D", "E", "F"];

export default function MCQModal({ wikiId, onClose }) {
  const [mcqs, setMcqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState(null);
  const [score, setScore] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  
  const isMounted = useRef(true);
  const fetchFired = useRef(false);

  useEffect(() => {
    isMounted.current = true;
    if (fetchFired.current) return;
    fetchFired.current = true;

    async function loadMCQ() {
      try {
        setLoading(true);
        const data = await generateMCQ(wikiId);
        if (isMounted.current) {
          setMcqs(data.mcqs || []);
        }
      } catch (err) {
        if (isMounted.current) {
          setError(err.response?.data?.message || err.message || "Failed to generate quiz");
        }
      } finally {
        if (isMounted.current) {
          setLoading(false);
        }
      }
    }
    loadMCQ();
    return () => {
      isMounted.current = false;
    };
  }, [wikiId]);

  const handleSelect = (idx) => {
    if (selectedOption !== null) return; // prevent changing answer
    setSelectedOption(idx);
    
    if (idx === mcqs[currentIndex].answer) {
      setScore((s) => s + 1);
    }
  };

  const handleNext = () => {
    if (currentIndex < mcqs.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setSelectedOption(null);
    } else {
      setIsFinished(true);
    }
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flashcards-loading">
          <div className="spinner"></div>
          <p>Analyzing wiki & crafting questions...</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flashcards-loading" style={{ color: "var(--ws-text-danger)" }}>
          <span style={{ fontSize: "2rem" }}>⚠️</span>
          <p>{error}</p>
        </div>
      );
    }

    if (mcqs.length === 0) {
      return (
        <div className="flashcards-loading">
          <p>No questions generated.</p>
        </div>
      );
    }

    if (isFinished) {
      return (
        <div className="mcq-results">
          <span style={{ fontSize: "4rem" }}>
            {score === mcqs.length ? "🏆" : score > mcqs.length / 2 ? "🌟" : "📚"}
          </span>
          <h1>{score} / {mcqs.length}</h1>
          <p>
            {score === mcqs.length 
              ? "Perfect score! You've mastered this topic." 
              : "Great effort! Keep studying to get a perfect score."}
          </p>
          <button className="mcq-results-btn" onClick={onClose}>Finish</button>
        </div>
      );
    }

    const question = mcqs[currentIndex];
    const isAnswered = selectedOption !== null;

    return (
      <div className="mcq-question-area">
        <h3 className="mcq-question-text">
          {currentIndex + 1}. {question.q}
        </h3>
        
        <div className="mcq-options">
          {question.options.map((opt, idx) => {
            let stateClass = "";
            if (isAnswered) {
              if (idx === question.answer) {
                stateClass = "is-correct";
              } else if (idx === selectedOption) {
                stateClass = "is-wrong";
              }
            }
            
            return (
              <button 
                key={idx}
                className={`mcq-option ${stateClass}`}
                disabled={isAnswered}
                onClick={() => handleSelect(idx)}
              >
                <div className="mcq-option-letter">{ALPHABET[idx] || "-"}</div>
                <span>{opt}</span>
              </button>
            );
          })}
        </div>
        
        <div className="mcq-footer" style={{ visibility: isAnswered ? "visible" : "hidden" }}>
          <span className="mcq-score-live">Current Score: {score}</span>
          <button className="mcq-next-btn" onClick={handleNext}>
            {currentIndex === mcqs.length - 1 ? "View Results" : "Next Question"}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="mcq-modal-backdrop" onClick={onClose}>
      <div className="mcq-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="mcq-header">
          <h2>Wiki Quiz</h2>
          {!loading && !error && mcqs.length > 0 && !isFinished && (
            <div className="mcq-progress-wrapper">
              <div 
                className="mcq-progress-bar" 
                style={{ width: `${((currentIndex) / mcqs.length) * 100}%` }}
              />
            </div>
          )}
          <button className="close-button" onClick={onClose} aria-label="Close">
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {renderContent()}
      </div>
    </div>
  );
}

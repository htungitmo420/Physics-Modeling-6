"use strict";
importScripts("physics.js");

self.onmessage = ({ data: { id, config } }) => {
  try {
    self.postMessage({ id, result: self.Simulation.solve(config) });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};

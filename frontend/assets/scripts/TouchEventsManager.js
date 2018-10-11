window.ALL_MAP_STATES = {

  VISUAL: 0, // For free dragging & zooming.

  EDITING_BELONGING: 1,

};

cc.Class({
  extends: cc.Component,
  properties: {
    // For joystick begins.
    stickhead: {
      default: null,
      type: cc.Node
    },
    base: {
      default: null,
      type: cc.Node
    },
    joyStickEps: {
      default: 0.10,
      type: cc.Float
    },
    magicLeanLowerBound: {
      default: 0.414, // Tangent of (PI/8).
      type: cc.Float
    },
    magicLeanUpperBound: {
      default: 2.414, // Tangent of (3*PI/8).
      type: cc.Float
    },
    // For joystick ends.
    pollerFps: {
      default: 10,
      type: cc.Integer
    },
    linearScaleFacBase: {
      default: 1.00,
      type: cc.Float
    },
    minScale: {
      default: 1.00,
      type: cc.Float
    },
    maxScale: {
      default: 2.50,
      type: cc.Float
    },
    maxMovingBufferLength: {
      default: 1,
      type: cc.Integer
    },
    zoomingScaleFacBase: {
      default: 0.10,
      type: cc.Float
    },
    zoomingSpeedBase: {
      default: 4.0,
      type: cc.Float
    },
    linearSpeedBase: {
      default: 320.0,
      type: cc.Float
    },
    canvasNode: {
      default: null,
      type: cc.Node
    },
    mapNode: {
      default: null,
      type: cc.Node
    },
    linearMovingEps: {
      default: 0.10,
      type: cc.Float
    },
    scaleByEps: {
      default: 0.0375,
      type: cc.Float
    },
  },

  start() {},

  onLoad() {
    this.cachedStickHeadPosition = cc.v2(0.0, 0.0);
    this.activeDirection = {
      dPjX: 0.0,
      dPjY: 0.0
    };
    this.maxHeadDistance = (0.5 * this.base.width);

    this._initTouchEvent();
    this._cachedMapNodePosTarget = [];
    this._cachedZoomRawTarget = null;

    this.mapScriptIns = this.mapNode.getComponent("Map");
    this.initialized = true;

    this._startMainLoop();
  },

  onDestroy() {
    clearInterval(this.mainLoopTimer); 
  },

  _startMainLoop() {
    const self = this;
    const linearSpeedBase = self.linearSpeedBase;
    const zoomingSpeed = self.zoomingSpeedBase;

    self.mainLoopTimer = setInterval(() => {
      if (false == self.mapScriptIns._inputControlEnabled) return;
      if (null != self._cachedMapNodePosTarget) {
        while (self.maxMovingBufferLength < self._cachedMapNodePosTarget.length) {
          self._cachedMapNodePosTarget.shift();
        }
        if (0 < self._cachedMapNodePosTarget.length && 0 == self.mapNode.getNumberOfRunningActions()) {
          const nextMapNodePosTarget = self._cachedMapNodePosTarget.shift();
          const linearSpeed = linearSpeedBase;
          const finalDiffVec = nextMapNodePosTarget.pos.sub(self.mapNode.position);
          const finalDiffVecMag = finalDiffVec.mag();
          if (self.linearMovingEps > finalDiffVecMag) {
            // Jittering.
            // cc.log("Map node moving by finalDiffVecMag == %s is just jittering.", finalDiffVecMag);
            return;
          }
          const durationSeconds = finalDiffVecMag / linearSpeed;
          cc.log("Map node moving to %o in %s/%s == %s seconds.", nextMapNodePosTarget.pos, finalDiffVecMag, linearSpeed, durationSeconds);
          const bufferedTargetPos = cc.v2(nextMapNodePosTarget.pos.x, nextMapNodePosTarget.pos.y);
          self.mapNode.runAction(cc.sequence(
            cc.moveTo(durationSeconds, bufferedTargetPos),
            cc.callFunc(() => {
              if (self._isMapOverMoved(self.mapNode.position)) {
                self.mapNode.setPosition(bufferedTargetPos);
              }
            }, self)
          ));
        }
      }
      if (null != self._cachedZoomRawTarget && false == self._cachedZoomRawTarget.processed) {
        cc.log(`Processing self._cachedZoomRawTarget == ${self._cachedZoomRawTarget}`);
        self._cachedZoomRawTarget.processed = true;
        self.canvasNode.setScale(self._cachedZoomRawTarget.scale);
      }
    }, 1000 / self.pollerFps);
  },

  _initTouchEvent() {
    const self = this;
    self.touchStartPosInMapNode = null;
    self.inTouchPoints = new Map();
    self.inMultiTouch = false;

    self.canvasNode.on(cc.Node.EventType.TOUCH_START, function(event) {
      self._touchStartEvent(event);
    });
    self.canvasNode.on(cc.Node.EventType.TOUCH_MOVE, function(event) {
      self._touchMoveEvent(event);
    });
    self.canvasNode.on(cc.Node.EventType.TOUCH_END, function(event) {
      self._touchEndEvent(event);
    });
    self.canvasNode.on(cc.Node.EventType.TOUCH_CANCEL, function(event) {
      self._touchEndEvent(event);
    });
  },

  _touchStartEvent(event) {
    for (let touch of event._touches) {
      this.inTouchPoints.set(touch._id, touch);
    }
    if (1 < this.inTouchPoints.size) {
      this.inMultiTouch = true;
    }
    
    if (!this.inMultiTouch) {
      this.touchStartPosInMapNode = this.mapNode.convertToNodeSpaceAR(event.currentTouch);
    }
  },

  _isMapOverMoved(mapTargetPos) {
    const virtualPlayerPos = cc.v2(-mapTargetPos.x, -mapTargetPos.y);
    return tileCollisionManager.isOutOfMapNode(this.mapNode, virtualPlayerPos);
  },

  _touchMoveEvent(event) {
    if (ALL_MAP_STATES.VISUAL != this.mapScriptIns.state) {
      return;
    }
    const linearScaleFacBase = this.linearScaleFacBase;
    const zoomingScaleFacBase = this.zoomingScaleFacBase;
    if (!this.inMultiTouch) {
      if (!this.inTouchPoints.has(event.currentTouch._id)) {
        return;
      }
      const diffVec = event.currentTouch._point.sub(event.currentTouch._startPoint);
      const scaleFactor = linearScaleFacBase / this.canvasNode.getScale();
      const diffVecScaled = (diffVec).mul(scaleFactor);
      const distance = diffVecScaled.mag();
      const overMoved = (distance > this.maxHeadDistance);
      if (overMoved) {
        const ratio = (this.maxHeadDistance / distance);
        this.cachedStickHeadPosition = diffVecScaled.mul(ratio);
      } else {
        const ratio = (distance / this.maxHeadDistance);
        this.cachedStickHeadPosition = diffVecScaled.mul(ratio);
      }
    } else {
      if (2 == event._touches.length) {
        const firstTouch = event._touches[0];
        const secondTouch = event._touches[1];

        const startMagnitude = firstTouch._startPoint.sub(secondTouch._startPoint).mag();
        const currentMagnitude = firstTouch._point.sub(secondTouch._point).mag();

        let scaleBy = (currentMagnitude / startMagnitude);
        scaleBy = 1 + (scaleBy - 1) * zoomingScaleFacBase;
        if (1 < scaleBy && Math.abs(scaleBy - 1) < this.scaleByEps) {
          // Jitterring.
          cc.log(`ScaleBy == ${scaleBy} is just jittering.`);
          return;
        }
        if (1 > scaleBy && Math.abs(scaleBy - 1) < 0.5 * this.scaleByEps) {
          // Jitterring.
          cc.log(`ScaleBy == ${scaleBy} is just jittering.`);
          return;
        }
        const targetScale = this.canvasNode.getScale() * scaleBy;
        if (this.minScale > targetScale || targetScale > this.maxScale) {
          return;
        }
        this._cachedZoomRawTarget = {
          scale: targetScale,
          timestamp: Date.now(),
          processed: false
        };
      }
    }
  },

  _touchEndEvent(event) {
    do {
      if (this.inMultiTouch) {
        break;
      }
      if (!this.inTouchPoints.has(event.currentTouch._id)) {
        break;
      }
      const diffVec = event.currentTouch._point.sub(event.currentTouch._startPoint);
      const diffVecMag = diffVec.mag();
      if (this.linearMovingEps <= diffVecMag) {
        break;
      }
      // Only triggers map-state-switch when `diffVecMag` is sufficiently small.

      if (ALL_MAP_STATES.VISUAL != this.mapScriptIns.state) {
        break;
      }

      // TODO: Handle single-finger-click event.
    } while (false);
    this.touchStartPosInMapNode = null;
    this.cachedStickHeadPosition = cc.v2(0.0, 0.0);
    for (let touch of event._touches) {
      if(touch){
        this.inTouchPoints.delete(touch._id);
      }
    }
    if (0 == this.inTouchPoints.size) {
      this.inMultiTouch = false;
    }
  },

  _touchCancelEvent(event) {},

  update(dt) {
    if (this.inMultiTouch) return;
    if (true != this.initialized) return;
    this.stickhead.setPosition(this.cachedStickHeadPosition);
    const eps = this.joyStickEps;

    if (Math.abs(this.cachedStickHeadPosition.x) < eps && Math.abs(this.cachedStickHeadPosition.y) < eps) {
      this.activeDirection.dPjX = 0;
      this.activeDirection.dPjY = 0;
      return;
    }

    // Discretization of 8 projected planar directions.
    if (Math.abs(this.cachedStickHeadPosition.x) < eps) {
      this.activeDirection.dPjX = 0;
      this.activeDirection.dPjY = this.cachedStickHeadPosition.y > 0 ? +1 : -1;
    } else if (Math.abs(this.cachedStickHeadPosition.y) < eps) {
      this.activeDirection.dPjX = this.cachedStickHeadPosition.x > 0 ? +2 : -2;
      this.activeDirection.dPjY = 0;
    } else {
      const criticalRatio = this.cachedStickHeadPosition.y / this.cachedStickHeadPosition.x;
      if (criticalRatio > this.magicLeanLowerBound && criticalRatio < this.magicLeanUpperBound) {
        this.activeDirection.dPjX = this.cachedStickHeadPosition.x > 0 ? +2 : -2;
        this.activeDirection.dPjY = this.cachedStickHeadPosition.x > 0 ? +1 : -1;
      } else if (criticalRatio > -this.magicLeanUpperBound && criticalRatio < -this.magicLeanLowerBound) {
        this.activeDirection.dPjX = this.cachedStickHeadPosition.x > 0 ? +2 : -2;
        this.activeDirection.dPjY = this.cachedStickHeadPosition.x > 0 ? -1 : +1;
      } else {
        if (Math.abs(criticalRatio) < 1) {
          this.activeDirection.dPjX = this.cachedStickHeadPosition.x > 0 ? +2 : -2;
          this.activeDirection.dPjY = 0;
        } else {
          this.activeDirection.dPjX = 0;
          this.activeDirection.dPjY = this.cachedStickHeadPosition.y > 0 ? +1 : -1;
        }
      }
    }
  }
});
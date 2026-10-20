(function (window) {
  'use strict';

  /** Decorative background field. Resizing the canvas never re-rolls orbs. */
  function initOrbField() {
    var canvas = document.getElementById('orbCanvas');
    if (!canvas || !canvas.getContext) return;

    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var width = 0;
    var height = 0;
    var dpr = 1;
    var points = [];
    var frameId = 0;
    var paused = false;
    var initialized = false;

    function seedPoints() {
      var count = Math.max(12, Math.min(30, Math.round(width * height / 42000)));
      for (var i = 0; i < count; i += 1) {
        points.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.23,
          vy: (Math.random() - 0.5) * 0.23,
          r: 2 + Math.random() * 3,
          phase: Math.random() * Math.PI * 2
        });
      }
      initialized = true;
    }

    function resize() {
      var nextWidth = Math.max(1, window.innerWidth);
      var nextHeight = Math.max(1, window.innerHeight);
      var nextDpr = Math.min(window.devicePixelRatio || 1, 1.5);
      var sizeChanged = nextWidth !== width || nextHeight !== height || nextDpr !== dpr;
      if (!sizeChanged) return;

      width = nextWidth;
      height = nextHeight;
      dpr = nextDpr;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Seed once. On every later resize keep the same points, phases and speeds;
      // only wrap a point if a user shrinks the viewport past its current position.
      if (!initialized) {
        seedPoints();
      } else {
        points.forEach(function (point) {
          if (point.x > width + 30) point.x = width - 1;
          if (point.y > height + 30) point.y = height - 1;
        });
      }
    }

    function frame(time) {
      if (!paused) {
        ctx.clearRect(0, 0, width, height);
        var orbRgb = window.getComputedStyle(document.body).getPropertyValue('--orb-rgb').trim() || '220,220,226';
        var line = orbRgb;
        var dot = orbRgb;

        for (var i = 0; i < points.length; i += 1) {
          var point = points[i];
          point.x += point.vx;
          point.y += point.vy;
          if (point.x < -30) point.x = width + 30;
          if (point.x > width + 30) point.x = -30;
          if (point.y < -30) point.y = height + 30;
          if (point.y > height + 30) point.y = -30;

          var pulse = 0.7 + 0.3 * Math.sin(time * 0.0006 + point.phase);
          for (var j = i + 1; j < points.length; j += 1) {
            var other = points[j];
            var dx = point.x - other.x;
            var dy = point.y - other.y;
            var distance = Math.sqrt(dx * dx + dy * dy);
            var maxDistance = 155;
            if (distance < maxDistance) {
              var alpha = (1 - distance / maxDistance) * 0.13;
              ctx.strokeStyle = 'rgba(' + line + ',' + alpha + ')';
              ctx.lineWidth = 0.7;
              ctx.beginPath();
              ctx.moveTo(point.x, point.y);
              ctx.lineTo(other.x, other.y);
              ctx.stroke();
            }
          }

          var glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, point.r * 7);
          glow.addColorStop(0, 'rgba(' + dot + ',' + (0.15 * pulse) + ')');
          glow.addColorStop(1, 'rgba(' + dot + ',0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(point.x, point.y, point.r * 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(' + dot + ',' + (0.28 * pulse) + ')';
          ctx.beginPath();
          ctx.arc(point.x, point.y, point.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      frameId = window.requestAnimationFrame(frame);
    }

    resize();
    window.addEventListener('resize', resize, { passive: true });
    document.addEventListener('visibilitychange', function () {
      paused = document.hidden;
    });
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      canvas.style.display = 'none';
      return;
    }
    if (!frameId) frameId = window.requestAnimationFrame(frame);
  }

  window.BasaltEffects = { initOrbField: initOrbField };
})(window);

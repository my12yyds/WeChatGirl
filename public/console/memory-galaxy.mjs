export const TAU=2*Math.PI;
export const armAngle=(arm,radius)=>arm*TAU/3+radius*5.25;
const TILT=-.24;
const DISTANCE=3.1;
const STRIDE=8;

export function galaxyProjection(width,height,zoom,phase,inclination){
  const scale=Math.min(width*.51,height*.82)*zoom;
  const c=Math.cos(phase),s=Math.sin(phase),flat=Math.cos(inclination),slope=Math.sin(inclination);
  const rollC=Math.cos(TILT),rollS=Math.sin(TILT);
  return {scale,rotation:[c,s,flat,slope],roll:[rollC,rollS],distance:DISTANCE,point({x,y,z=0}){
    const u=x*c-y*s,v=x*s+y*c;
    const depth=v*slope-z*flat;
    const factor=DISTANCE/(DISTANCE-depth);
    const vertical=v*flat+z*slope;
    return {x:width*.5+(u*rollC-vertical*rollS)*scale*factor,
      y:height*.5+(u*rollS+vertical*rollC)*scale*factor,depth,factor};
  }};
}

// Generate a disk with height, plus a round central bulge and a sparse stellar halo.
function starCloud(){
  const cloud=new Float32Array(21800*STRIDE);
  let seed=0x39b87e21;
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const scatter=()=>random()+random()+random()+random()-2;
  const colors=[[.75,.51,1],[.40,.80,1],[1,.56,.69]];
  for(let i=0;i<cloud.length/STRIDE;i++){
    const bulge=i<3300,halo=i>=20400,arm=i%3;
    const radius=bulge ? Math.pow(random(),1.7)*.29 : halo ? .4+random()*.68 : Math.pow(random(),1.22)*.99;
    const angle=bulge||halo||i%9===0?random()*TAU:armAngle(arm,radius)+scatter()*(.17+.09/(radius+.32));
    const z=scatter()*(bulge ? .235 : halo ? .38 : .035+.07*(1-radius));
    const bright=i%69===0;
    const color=bulge||radius<.14?[1,.83,.64]:halo?[.67,.73,.93]:colors[arm];
    const alpha=(bright ? .91 : .24+random()*.56)*(halo ? .50 : 1-radius*.38);
    cloud.set([Math.cos(angle)*radius,Math.sin(angle)*radius,z,...color,alpha,bright?7+random()*9:1.45+random()*2.2],i*STRIDE);
  }
  return cloud;
}

const vertex=`
attribute vec3 aPosition;
attribute vec4 aColor;
attribute float aSize;
uniform vec4 uRotation;
uniform vec2 uRoll;
uniform vec2 uViewport;
uniform float uScale;
uniform float uDistance;
uniform float uDensity;
varying vec4 vColor;
void main(){
  float u = aPosition.x * uRotation.x - aPosition.y * uRotation.y;
  float v = aPosition.x * uRotation.y + aPosition.y * uRotation.x;
  float depth = v * uRotation.w - aPosition.z * uRotation.z;
  float vertical = v * uRotation.z + aPosition.z * uRotation.w;
  float perspective = uDistance / (uDistance - depth);
  vec2 projected = vec2(u * uRoll.x - vertical * uRoll.y, u * uRoll.y + vertical * uRoll.x);
  gl_Position = vec4(projected * uScale * perspective * vec2(2.0,-2.0) / uViewport, 0.0, 1.0);
  gl_PointSize = max(1.0, aSize * perspective * uDensity);
  vColor = aColor;
}`;

const fragment=`
precision mediump float;
varying vec4 vColor;
void main(){
  float distanceToCenter = length(gl_PointCoord - vec2(0.5)) * 2.0;
  float intensity = pow(max(0.0, 1.0 - distanceToCenter), 1.65) * vColor.a;
  gl_FragColor = vec4(vColor.rgb * intensity, intensity);
}`;

function programFor(gl){
  const program=gl.createProgram();
  for(const [kind,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){
    const shader=gl.createShader(kind);
    gl.shaderSource(shader,source);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){
      gl.deleteShader(shader);gl.deleteProgram(program);return null;
    }
    gl.attachShader(program,shader);gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if(gl.getProgramParameter(program,gl.LINK_STATUS))return program;
  gl.deleteProgram(program);return null;
}

export function createGalaxyRenderer(canvas,onChange){
  const cloud=starCloud();
  let gl,program,buffer,uniforms,fallbackColors;
  const lifecycle=new AbortController();
  function setup(){
    gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,depth:false,antialias:false});
    if(!gl)return;
    program=programFor(gl);
    if(!program)return;
    gl.useProgram(program);
    buffer=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,cloud,gl.STATIC_DRAW);
    for(const [name,size,offset] of [['aPosition',3,0],['aColor',4,3],['aSize',1,7]]){
      const location=gl.getAttribLocation(program,name);
      gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,STRIDE*4,offset*4);
    }
    uniforms=Object.fromEntries(['Rotation','Roll','Viewport','Scale','Distance','Density'].map(name=>[name,gl.getUniformLocation(program,'u'+name)]));
    gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0,0,0,0);
  }
  try{setup();}catch{program=null;}
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();program=null;onChange();},{signal:lifecycle.signal});
  canvas.addEventListener('webglcontextrestored',()=>{try{setup();}catch{program=null;}onChange();},{signal:lifecycle.signal});

  return {
    draw(context,camera,width,height,density){
      const backend=program?'webgl':'canvas';
      if(canvas.dataset.renderer!==backend)canvas.dataset.renderer=backend;
      if(program){
        gl.viewport(0,0,canvas.width,canvas.height);gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform4fv(uniforms.Rotation,camera.rotation);gl.uniform2fv(uniforms.Roll,camera.roll);
        gl.uniform2f(uniforms.Viewport,width,height);gl.uniform1f(uniforms.Scale,camera.scale);
        gl.uniform1f(uniforms.Distance,camera.distance);gl.uniform1f(uniforms.Density,density);
        gl.drawArrays(gl.POINTS,0,cloud.length/STRIDE);
        return;
      }
      // Keep perspective and the common rotation when hardware acceleration is unavailable.
      fallbackColors??=Array.from({length:Math.ceil(cloud.length/(STRIDE*7))},(_,index)=>{
        const i=index*STRIDE*7;
        return `rgba(${Math.round(cloud[i+3]*255)},${Math.round(cloud[i+4]*255)},${Math.round(cloud[i+5]*255)},${cloud[i+6]})`;
      });
      for(let i=0,index=0;i<cloud.length;i+=STRIDE*7,index++){
        const point=camera.point({x:cloud[i],y:cloud[i+1],z:cloud[i+2]});
        const size=Math.min(3.8,cloud[i+7]*point.factor*.66);
        context.fillStyle=fallbackColors[index];
        context.fillRect(point.x-size/2,point.y-size/2,size,size);
      }
    },
    dispose(){lifecycle.abort();if(program){gl.deleteBuffer(buffer);gl.deleteProgram(program);}}
  };
}

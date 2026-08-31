import type { Project } from '@contracts/index';

type Props = {
  projects: Project[];
  activeProject?: Project;
  onSelect: (projectId?: string) => void;
};

export function ProjectPicker({ projects, activeProject, onSelect }: Props) {
  return (
    <section className="project-switcher" aria-labelledby="workspace-heading">
      <div className="section-kicker" id="workspace-heading">Workspace</div>
      <button className="workspace-trigger" onClick={() => onSelect()} type="button">
        <span className="workspace-mark" aria-hidden="true">{activeProject ? activeProject.name.slice(0, 1).toUpperCase() : '+'}</span>
        <span className="workspace-copy">
          <strong>{activeProject?.name ?? 'Choose a project'}</strong>
          <small>{activeProject?.path ?? 'Open a folder to begin'}</small>
        </span>
        <span className="chevron" aria-hidden="true">⌄</span>
      </button>
      {projects.length > 1 && (
        <div className="workspace-list" aria-label="Recent projects">
          {projects.filter((project) => project.id !== activeProject?.id).slice(0, 3).map((project) => (
            <button className="workspace-recent" key={project.id} onClick={() => onSelect(project.id)} type="button">
              <span>{project.name}</span>
              <small>{project.path}</small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
